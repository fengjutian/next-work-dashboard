/**
 * WorkspaceStore — workspaces / tabs / notes / tasks / ai_conversations / search_history CRUD
 */
import type Database from 'better-sqlite3';
import type {
  Workspace, WorkspaceId, Tab, TabId, TabStatus,
  Note, NoteId, Task, TaskId, TaskStatus, TaskStep,
  AIConversation, ConversationId, AIMessage, AIContext, SearchHistoryEntry,
} from '../../core/work-browser/types';
import { newId, now } from '../../core/work-browser/types';

export class WorkspaceStore {
  constructor(private db: Database.Database) {}

  // ── Workspace ──

  listWorkspaces(includeArchived = false): Workspace[] {
    const rows = includeArchived
      ? this.db.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC').all()
      : this.db.prepare('SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY updated_at DESC').all();
    return rows.map(rowToWorkspace);
  }

  getWorkspace(id: WorkspaceId): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    return row ? rowToWorkspace(row) : null;
  }

  createWorkspace(input: { name: string; description?: string; icon?: string; color?: string; storagePath?: string; privacyMode?: 'normal' | 'local-only' }): Workspace {
    const t = now();
    const ws: Workspace = {
      id: newId<WorkspaceId>(),
      name: input.name,
      description: input.description || '',
      icon: input.icon || '🌊',
      color: input.color || '#2563eb',
      storagePath: input.storagePath || '',
      privacyMode: input.privacyMode || 'normal',
      createdAt: t,
      updatedAt: t,
      archivedAt: null,
    };
    this.db.prepare(`INSERT INTO workspaces(id, name, description, icon, color, storage_path, privacy_mode, created_at, updated_at, archived_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      ws.id, ws.name, ws.description, ws.icon, ws.color, ws.storagePath, ws.privacyMode, ws.createdAt, ws.updatedAt, ws.archivedAt,
    );
    return ws;
  }

  updateWorkspace(id: WorkspaceId, patch: Partial<Workspace>): void {
    const cur = this.getWorkspace(id);
    if (!cur) return;
    const merged = { ...cur, ...patch, id: cur.id, updatedAt: now() };
    this.db.prepare(`UPDATE workspaces SET name=?, description=?, icon=?, color=?, storage_path=?, privacy_mode=?, updated_at=?, archived_at=? WHERE id=?`)
      .run(merged.name, merged.description, merged.icon, merged.color, merged.storagePath, merged.privacyMode, merged.updatedAt, merged.archivedAt, id);
  }

  archiveWorkspace(id: WorkspaceId): void {
    this.db.prepare('UPDATE workspaces SET archived_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  }

  // ── Tab ──

  listTabs(workspaceId: WorkspaceId): Tab[] {
    const rows = this.db.prepare('SELECT * FROM tabs WHERE workspace_id = ? ORDER BY position ASC, created_at ASC').all(workspaceId) as any[];
    return rows.map(rowToTab);
  }

  createTab(input: { workspaceId: WorkspaceId; url: string; title?: string; position?: number }): Tab {
    const t = now();
    const pos = input.position ?? Number(this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tabs WHERE workspace_id = ?').get(input.workspaceId) as { p: number });
    const tab: Tab = {
      id: newId<TabId>(),
      workspaceId: input.workspaceId,
      url: input.url,
      title: input.title || input.url,
      favicon: null,
      webContentsId: null,
      isPinned: false,
      isMuted: false,
      position: pos,
      status: 'loading' as TabStatus,
      lastActivatedAt: t,
      createdAt: t,
      activeTimeMs: 0,
    };
    this.db.prepare(`INSERT INTO tabs(id, workspace_id, url, title, favicon, web_contents_id, is_pinned, is_muted, position, status, last_activated_at, created_at, active_time_ms)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      tab.id, tab.workspaceId, tab.url, tab.title, tab.favicon, tab.webContentsId,
      tab.isPinned ? 1 : 0, tab.isMuted ? 1 : 0, tab.position, tab.status,
      tab.lastActivatedAt, tab.createdAt, tab.activeTimeMs,
    );
    return tab;
  }

  updateTab(id: TabId, patch: Partial<Tab>): void {
    const cur = this.listTabsAll().find((t) => t.id === id);
    if (!cur) return;
    const merged = { ...cur, ...patch, id: cur.id };
    this.db.prepare(`UPDATE tabs SET url=?, title=?, favicon=?, web_contents_id=?, is_pinned=?, is_muted=?, position=?, status=?, last_activated_at=?, active_time_ms=? WHERE id=?`)
      .run(merged.url, merged.title, merged.favicon, merged.webContentsId,
           merged.isPinned ? 1 : 0, merged.isMuted ? 1 : 0, merged.position, merged.status,
           merged.lastActivatedAt, merged.activeTimeMs, id);
  }

  deleteTab(id: TabId): void {
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(id);
  }

  // ── Note ──

  listNotes(workspaceId: WorkspaceId): Note[] {
    const rows = this.db.prepare('SELECT * FROM notes WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[];
    return rows.map(rowToNote);
  }

  createNote(input: { workspaceId: WorkspaceId; title: string; content: string; documentId?: string; tabId?: string; taskId?: string; tags?: string[] }): Note {
    const t = now();
    const note: Note = {
      id: newId<NoteId>(),
      workspaceId: input.workspaceId,
      documentId: (input.documentId as Note['documentId']) || null,
      tabId: (input.tabId as Note['tabId']) || null,
      taskId: (input.taskId as Note['taskId']) || null,
      title: input.title,
      content: input.content,
      tags: input.tags || [],
      createdAt: t,
      updatedAt: t,
    };
    this.db.prepare(`INSERT INTO notes(id, workspace_id, document_id, tab_id, task_id, title, content, tags, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      note.id, note.workspaceId, note.documentId, note.tabId, note.taskId, note.title, note.content, JSON.stringify(note.tags), note.createdAt, note.updatedAt,
    );
    return note;
  }

  // ── Task ──

  listTasks(workspaceId: WorkspaceId, status?: TaskStatus): Task[] {
    const sql = status
      ? 'SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC';
    const rows = (status ? this.db.prepare(sql).all(workspaceId, status) : this.db.prepare(sql).all(workspaceId)) as any[];
    return rows.map(rowToTask);
  }

  upsertTask(task: Task): void {
    const exists = this.db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(task.id);
    if (exists) {
      this.db.prepare(`UPDATE tasks SET title=?, description=?, status=?, related_document_ids=?, related_tab_ids=?, related_note_ids=?, steps=?, ai_generated=?, updated_at=?, resolved_at=? WHERE id=?`)
        .run(task.title, task.description, task.status,
             JSON.stringify(task.relatedDocumentIds), JSON.stringify(task.relatedTabIds), JSON.stringify(task.relatedNoteIds),
             JSON.stringify(task.steps), task.aiGenerated ? 1 : 0, task.updatedAt, task.resolvedAt, task.id);
    } else {
      this.db.prepare(`INSERT INTO tasks(id, workspace_id, title, description, status, related_document_ids, related_tab_ids, related_note_ids, steps, ai_generated, created_at, updated_at, resolved_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        task.id, task.workspaceId, task.title, task.description, task.status,
        JSON.stringify(task.relatedDocumentIds), JSON.stringify(task.relatedTabIds), JSON.stringify(task.relatedNoteIds),
        JSON.stringify(task.steps), task.aiGenerated ? 1 : 0, task.createdAt, task.updatedAt, task.resolvedAt,
      );
    }
  }

  // ── AI Conversation ──

  listConversations(workspaceId: WorkspaceId): AIConversation[] {
    const rows = this.db.prepare('SELECT * FROM ai_conversations WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[];
    return rows.map(rowToConversation);
  }

  getConversation(id: ConversationId): AIConversation | null {
    const row = this.db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id) as any;
    return row ? rowToConversation(row) : null;
  }

  upsertConversation(conv: AIConversation): void {
    const exists = this.db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(conv.id);
    const t = now();
    const messages = JSON.stringify(conv.messages);
    const ctx = JSON.stringify(conv.context);
    if (exists) {
      this.db.prepare('UPDATE ai_conversations SET title = ?, messages = ?, context = ?, updated_at = ? WHERE id = ?')
        .run(conv.title, messages, ctx, t, conv.id);
    } else {
      this.db.prepare('INSERT INTO ai_conversations(id, workspace_id, title, messages, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(conv.id, conv.workspaceId, conv.title, messages, ctx, conv.createdAt, t);
    }
  }

  // ── Search History ──

  appendSearchHistory(entry: Omit<SearchHistoryEntry, 'id'>): void {
    this.db.prepare(`INSERT INTO search_history(id, workspace_id, text, providers, result_count, executed_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(newId(), entry.workspaceId, entry.text, JSON.stringify(entry.providers), entry.resultCount, entry.executedAt);
  }

  listSearchHistory(limit = 50): SearchHistoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM search_history ORDER BY executed_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id, workspaceId: r.workspace_id, text: r.text,
      providers: JSON.parse(r.providers || '[]'), resultCount: r.result_count, executedAt: r.executed_at,
    }));
  }

  // ── Settings (work-browser 专用 key) ──

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  // ── helpers ──

  private listTabsAll(): Tab[] {
    const rows = this.db.prepare('SELECT * FROM tabs').all() as any[];
    return rows.map(rowToTab);
  }
}

function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id, name: r.name, description: r.description, icon: r.icon, color: r.color,
    storagePath: r.storage_path, privacyMode: r.privacy_mode,
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
  };
}

function rowToTab(r: any): Tab {
  return {
    id: r.id, workspaceId: r.workspace_id, url: r.url, title: r.title, favicon: r.favicon,
    webContentsId: r.web_contents_id, isPinned: !!r.is_pinned, isMuted: !!r.is_muted,
    position: r.position, status: r.status, lastActivatedAt: r.last_activated_at,
    createdAt: r.created_at, activeTimeMs: r.active_time_ms,
  };
}

function rowToNote(r: any): Note {
  return {
    id: r.id, workspaceId: r.workspace_id,
    documentId: r.document_id, tabId: r.tab_id, taskId: r.task_id,
    title: r.title, content: r.content, tags: JSON.parse(r.tags || '[]'),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowToTask(r: any): Task {
  return {
    id: r.id, workspaceId: r.workspace_id,
    title: r.title, description: r.description, status: r.status,
    relatedDocumentIds: JSON.parse(r.related_document_ids || '[]'),
    relatedTabIds: JSON.parse(r.related_tab_ids || '[]'),
    relatedNoteIds: JSON.parse(r.related_note_ids || '[]'),
    steps: JSON.parse(r.steps || '[]') as TaskStep[],
    aiGenerated: !!r.ai_generated,
    createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at,
  };
}

function rowToConversation(r: any): AIConversation {
  return {
    id: r.id, workspaceId: r.workspace_id,
    title: r.title, messages: JSON.parse(r.messages || '[]') as AIMessage[],
    context: JSON.parse(r.context || '{}') as AIContext,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
