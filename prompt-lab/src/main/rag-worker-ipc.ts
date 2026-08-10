import { ipcMain } from 'electron';
import { ragWorkerClient } from './rag-worker-client';

function assertDocumentInput(value: unknown): void {
  const document = value as { id?: unknown; name?: unknown; chunks?: unknown[] } | null;
  if (!document || typeof document.id !== 'string' || !document.id || document.id.length > 1024
    || typeof document.name !== 'string' || document.name.length > 1024
    || !Array.isArray(document.chunks) || document.chunks.length > 20_000) {
    throw new Error('INVALID_RAG_DOCUMENT');
  }
  let totalCharacters = 0;
  for (const value of document.chunks) {
    const chunk = value as { id?: unknown; content?: unknown } | null;
    if (!chunk || typeof chunk.id !== 'string' || !chunk.id || chunk.id.length > 2048
      || typeof chunk.content !== 'string' || chunk.content.length > 2_000_000) {
      throw new Error('INVALID_RAG_CHUNK');
    }
    totalCharacters += chunk.content.length;
    if (totalCharacters > 100_000_000) throw new Error('RAG_DOCUMENT_TOO_LARGE');
  }
}

export function setupRagWorkerIPC(): void {
  ipcMain.handle('rag-worker:status', () => ragWorkerClient.availability());
  ipcMain.handle('rag-worker:upsert-document', (_event, document) => {
    assertDocumentInput(document);
    return ragWorkerClient.request('upsert_document', document, 120_000);
  });
  ipcMain.handle('rag-worker:delete-document', (_event, documentId: string) => {
    if (typeof documentId !== 'string' || !documentId || documentId.length > 1024) throw new Error('INVALID_DOCUMENT_ID');
    return ragWorkerClient.request('delete_document', { documentId });
  });
  ipcMain.handle('rag-worker:keyword-search', (_event, request: { query?: unknown }) => {
    if (!request || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 4096) throw new Error('INVALID_SEARCH_QUERY');
    return ragWorkerClient.request('keyword_search', request);
  });
  ipcMain.handle('rag-worker:fuse-results', (_event, request: { lists?: unknown[] }) => {
    if (!request || !Array.isArray(request.lists) || request.lists.length > 10) throw new Error('INVALID_RANKED_LISTS');
    return ragWorkerClient.request('fuse_results', request);
  });
  ipcMain.handle('rag-worker:index-status', () => ragWorkerClient.request('get_status'));
  ipcMain.handle('rag-worker:pending-outbox', (_event, limit?: number) => ragWorkerClient.request('get_pending_outbox', { limit }));
  ipcMain.handle('rag-worker:complete-outbox', (_event, id: number) => ragWorkerClient.request('complete_outbox', { id }));
  ipcMain.handle('rag-worker:fail-outbox', (_event, id: number, error: string) => ragWorkerClient.request('fail_outbox', { id, error }));
}
