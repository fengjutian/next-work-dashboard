import { ipcMain } from 'electron';
import { ragWorkerClient } from './rag-worker-client';

export function setupRagWorkerIPC(): void {
  ipcMain.handle('rag-worker:status', () => ragWorkerClient.availability());
  ipcMain.handle('rag-worker:upsert-document', (_event, document) => ragWorkerClient.request('upsert_document', document, 120_000));
  ipcMain.handle('rag-worker:delete-document', (_event, documentId: string) => ragWorkerClient.request('delete_document', { documentId }));
  ipcMain.handle('rag-worker:keyword-search', (_event, request) => ragWorkerClient.request('keyword_search', request));
  ipcMain.handle('rag-worker:fuse-results', (_event, request) => ragWorkerClient.request('fuse_results', request));
  ipcMain.handle('rag-worker:index-status', () => ragWorkerClient.request('get_status'));
  ipcMain.handle('rag-worker:pending-outbox', (_event, limit?: number) => ragWorkerClient.request('get_pending_outbox', { limit }));
  ipcMain.handle('rag-worker:complete-outbox', (_event, id: number) => ragWorkerClient.request('complete_outbox', { id }));
  ipcMain.handle('rag-worker:fail-outbox', (_event, id: number, error: string) => ragWorkerClient.request('fail_outbox', { id, error }));
}

