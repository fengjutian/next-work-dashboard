import { applyLanceDocumentOperations, type LanceDocumentIndexOperation } from './lancedb-memory';
import { ragWorkerClient } from './rag-worker-client';

const POLL_INTERVAL_MS = 3_000;
let timer: ReturnType<typeof setInterval> | null = null;
let active: Promise<void> | null = null;

async function consumeOnce(): Promise<void> {
  const response = await ragWorkerClient.request<{ operations: LanceDocumentIndexOperation[] }>('get_pending_outbox', { limit: 500 });
  const operations = response.operations.filter((operation) => operation.retryCount < 5);
  if (!operations.length) return;
  try {
    await applyLanceDocumentOperations(operations);
    for (const operation of operations) await ragWorkerClient.request('complete_outbox', { id: operation.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const operation of operations) {
      try { await ragWorkerClient.request('fail_outbox', { id: operation.id, error: message }); } catch { /* retry on the next app start */ }
    }
  }
}

function schedule(): void {
  if (active) return;
  active = consumeOnce().catch((error) => {
    console.warn('[RagIndexCoordinator] Deferred LanceDB synchronization.', error);
  }).finally(() => { active = null; });
}

export function startRagIndexCoordinator(): void {
  if (timer) return;
  schedule();
  timer = setInterval(schedule, POLL_INTERVAL_MS);
}

export function stopRagIndexCoordinator(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function triggerRagIndexSync(): void { schedule(); }

