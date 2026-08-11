/**
 * Work Browser — IPC 入口
 *
 * Channel 命名：work-browser:<domain>:<action>
 *
 * 规则：所有 channel 必须在 preload/work-browser.ts 中 ipcRenderer.invoke 对应。
 * scripts/check-ipc-contract.mjs 会自动校验。
 */
import { ipcMain } from 'electron';
import { getDatabase } from './database';
import { WorkspaceStore } from './workspace-store';
import { DocumentStore } from './document-store';
import { SearchRouter } from './search-router';
import { savePageAsMarkdown } from './save';
import { getCleanerPayload } from './cleaner';
import { suggestWorkspacesForDocument } from '../../core/work-browser/workspace/auto-group';
import type {
  WorkspaceId, TabId, DocumentId, ConversationId, TaskId, TaskStatus,
} from '../../core/work-browser/types';

let initialized = false;

export function setupWorkBrowserIPC(): void {
  if (initialized) return;
  initialized = true;

  const db = getDatabase();
  const workspaces = new WorkspaceStore(db);
  const documents = new DocumentStore(db);
  const search = new SearchRouter(workspaces);

  // ── Workspace ──

  ipcMain.handle('work-browser:workspace:list', (_e, includeArchived?: boolean) => workspaces.listWorkspaces(!!includeArchived));
  ipcMain.handle('work-browser:workspace:create', (_e, input: Parameters<WorkspaceStore['createWorkspace']>[0]) => workspaces.createWorkspace(input));
  ipcMain.handle('work-browser:workspace:update', (_e, id: WorkspaceId, patch: any) => { workspaces.updateWorkspace(id, patch); return workspaces.getWorkspace(id); });
  ipcMain.handle('work-browser:workspace:archive', (_e, id: WorkspaceId) => { workspaces.archiveWorkspace(id); });
  ipcMain.handle('work-browser:workspace:get', (_e, id: WorkspaceId) => workspaces.getWorkspace(id));

  // ── Tab ──

  ipcMain.handle('work-browser:tab:list', (_e, workspaceId: WorkspaceId) => workspaces.listTabs(workspaceId));
  ipcMain.handle('work-browser:tab:create', (_e, input: { workspaceId: WorkspaceId; url: string; title?: string }) => workspaces.createTab(input));
  ipcMain.handle('work-browser:tab:update', (_e, id: TabId, patch: any) => { workspaces.updateTab(id, patch); });
  ipcMain.handle('work-browser:tab:delete', (_e, id: TabId) => workspaces.deleteTab(id));

  // ── Document ──

  ipcMain.handle('work-browser:document:list', (_e, workspaceId: WorkspaceId, limit?: number) => documents.listDocuments(workspaceId, limit));
  ipcMain.handle('work-browser:document:get', (_e, id: DocumentId) => documents.getDocument(id));
  ipcMain.handle('work-browser:document:versions', (_e, id: DocumentId) => documents.listVersions(id));
  ipcMain.handle('work-browser:document:save', async (_e, input: Parameters<typeof savePageAsMarkdown>[0]) => {
    return await savePageAsMarkdown(input, workspaces, documents);
  });

  // ── Note ──

  ipcMain.handle('work-browser:note:list', (_e, workspaceId: WorkspaceId) => workspaces.listNotes(workspaceId));
  ipcMain.handle('work-browser:note:create', (_e, input: Parameters<WorkspaceStore['createNote']>[0]) => workspaces.createNote(input));

  // ── Task ──

  ipcMain.handle('work-browser:task:list', (_e, workspaceId: WorkspaceId, status?: TaskStatus) => workspaces.listTasks(workspaceId, status));
  ipcMain.handle('work-browser:task:upsert', (_e, task: any) => { workspaces.upsertTask(task); });

  // ── AI Conversation ──

  ipcMain.handle('work-browser:conversation:list', (_e, workspaceId: WorkspaceId) => workspaces.listConversations(workspaceId));
  ipcMain.handle('work-browser:conversation:get', (_e, id: ConversationId) => workspaces.getConversation(id));
  ipcMain.handle('work-browser:conversation:upsert', (_e, conv: any) => { workspaces.upsertConversation(conv); });

  // ── Search ──

  ipcMain.handle('work-browser:search:providers', () => search.listProviders());
  ipcMain.handle('work-browser:search:run', async (_e, input: { text: string; locale?: string; perPage?: number; workspaceId?: string }) => {
    return await search.runSearch(input);
  });
  ipcMain.handle('work-browser:search:suggest', async (_e, text: string) => await search.getSuggestions(text));
  ipcMain.handle('work-browser:search:history', (_e, limit?: number) => workspaces.listSearchHistory(limit));

  // ── Cleaner ──

  ipcMain.handle('work-browser:cleaner:payload', (_e, options?: any) => getCleanerPayload(options));

  // ── Settings ──

  ipcMain.handle('work-browser:settings:get', (_e, key: string) => workspaces.getSetting(key));
  ipcMain.handle('work-browser:settings:set', (_e, key: string, value: string) => { workspaces.setSetting(key, value); });

  // ── Auto-group ──

  ipcMain.handle('work-browser:auto-group:suggest', (_e, docSummary: { title: string; url: string; capturedAt: number }) => {
    const all = workspaces.listWorkspaces(false);
    return all
      .map((ws) => ({ workspace: ws, tabs: workspaces.listTabs(ws.id) }))
      .flatMap((entry) => suggestWorkspacesForDocument(docSummary, [entry]).map((c) => ({ workspaceId: c.workspaceId, score: c.score, reasons: c.reasons })));
  });
}
