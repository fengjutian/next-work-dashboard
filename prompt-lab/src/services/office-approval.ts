export interface OfficeApprovalRequest {
  id: string;
  operation: string;
  summary: string;
  arguments: Record<string, unknown>;
  destructive: boolean;
  respond(approved: boolean): void;
}

export interface OfficeAuditRecord {
  id: string; timestamp: number; operation: string; summary: string;
  approved: boolean; success?: boolean; error?: string;
}

const listeners = new Set<(request: OfficeApprovalRequest) => void>();
const AUDIT_KEY = 'office-studio:ai-audit-v1';

export function subscribeOfficeApproval(listener: (request: OfficeApprovalRequest) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}

export function listOfficeAudit(): OfficeAuditRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]') as OfficeAuditRecord[]; } catch { return []; }
}

function writeAudit(record: OfficeAuditRecord): void {
  if (typeof localStorage === 'undefined') return;
  const records = [record, ...listOfficeAudit()].slice(0, 200);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(records));
}

export async function requestOfficeApproval(operation: string, summary: string, args: Record<string, unknown>, destructive = false): Promise<boolean> {
  const listener = [...listeners][0];
  if (!listener) return false;
  return new Promise((resolve) => listener({
    id: crypto.randomUUID(), operation, summary, arguments: args, destructive,
    respond: (approved) => {
      writeAudit({ id: crypto.randomUUID(), timestamp: Date.now(), operation, summary, approved });
      resolve(approved);
    },
  }));
}

export function recordOfficeAuditResult(operation: string, summary: string, success: boolean, error?: string): void {
  writeAudit({ id: crypto.randomUUID(), timestamp: Date.now(), operation, summary, approved: true, success, error });
}
