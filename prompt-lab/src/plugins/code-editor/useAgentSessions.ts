import { useCallback, useEffect, useMemo, useState } from 'react';
import { archivedSessionsForWorkspace, createAgentLogEntry, createAgentSession, sessionsForWorkspace, type AgentLogEntry, type AgentSession } from './agent-sessions';
import { isDbReady, dbInsertAgentSession, dbUpdateAgentSession, dbDeleteAgentSession, dbInsertAgentLog, dbDeleteAgentLogs } from '@/db';

const STORAGE_KEY = 'code-editor.agent-sessions.v1';
const ACTIVE_KEY = 'code-editor.active-agent-sessions.v1';
const LOGS_KEY = 'code-editor.agent-logs.v1';

function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

export function useAgentSessions(workspace: { path: string; name: string } | null) {
  const [sessions, setSessions] = useState<AgentSession[]>(() => readStored(STORAGE_KEY, []));
  const [activeByWorkspace, setActiveByWorkspace] = useState<Record<string, string>>(() => readStored(ACTIVE_KEY, {}));
  const [logsBySession, setLogsBySession] = useState<Record<string, AgentLogEntry[]>>(() => readStored(LOGS_KEY, {}));
  const visibleSessions = useMemo(
    () => sessionsForWorkspace(sessions, workspace?.path),
    [sessions, workspace?.path],
  );
  const archivedSessions = useMemo(
    () => archivedSessionsForWorkspace(sessions, workspace?.path),
    [sessions, workspace?.path],
  );
  const activeSessionId = workspace ? activeByWorkspace[workspace.path] : undefined;
  const activeSession = visibleSessions.find((session) => session.id === activeSessionId) ?? visibleSessions[0] ?? null;
  const activeLogs = activeSession ? logsBySession[activeSession.id] ?? [] : [];

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-200))), [sessions]);
  // Also persist to SQLite
  useEffect(() => {
    if (!isDbReady() || sessions.length === 0) return;
    try {
      for (const s of sessions) {
        dbInsertAgentSession({
          id: s.id, title: s.title, status: s.status,
          instruction: (s as any).instruction ?? "",
          worktreePath: s.worktree?.path ?? null,
          worktreeBranch: s.worktree?.branch ?? null,
          worktreeHead: s.worktree?.head ?? null,
          worktreeDirty: s.worktree?.dirty ? 1 : 0,
          isPinned: s.pinned ? 1 : 0, parentSessionId: null,
          tokenBudget: null,
          createdAt: s.createdAt, updatedAt: s.updatedAt,
          archivedAt: s.archivedAt ?? null,
        });
      }
    } catch {}
  }, [sessions]);
  useEffect(() => localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeByWorkspace)), [activeByWorkspace]);
  useEffect(() => localStorage.setItem(LOGS_KEY, JSON.stringify(logsBySession)), [logsBySession]);
  useEffect(() => {
    if (!isDbReady()) return;
    for (const [sid, logs] of Object.entries(logsBySession)) {
      if (logs.length === 0) continue;
      const last = logs[logs.length - 1];
      try { dbInsertAgentLog({ id: last.id, sessionId: sid, level: last.level, message: last.message, seq: logs.length, timestamp: last.timestamp }); } catch {}
    }
  }, [logsBySession]);
  useEffect(() => {
    if (!workspace || !activeSession || activeByWorkspace[workspace.path] === activeSession.id) return;
    setActiveByWorkspace((previous) => ({ ...previous, [workspace.path]: activeSession.id }));
  }, [activeByWorkspace, activeSession, workspace]);

  const createSession = useCallback(() => {
    if (!workspace) return null;
    const session = createAgentSession(workspace);
    setSessions((previous) => [...previous, session]);
    setActiveByWorkspace((previous) => ({ ...previous, [workspace.path]: session.id }));
    return session;
  }, [workspace]);

  const selectSession = useCallback((id: string) => {
    if (!workspace) return;
    setActiveByWorkspace((previous) => ({ ...previous, [workspace.path]: id }));
  }, [workspace]);

  const updateSession = useCallback((id: string, patch: Partial<Omit<AgentSession, 'id' | 'workspacePath'>>) => {
    setSessions((previous) => previous.map((session) => session.id === id
      ? { ...session, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
      : session));
  }, []);

  const archiveSession = useCallback((id: string) => {
    const now = Date.now();
    setSessions((previous) => previous.map((session) => session.id === id
      ? { ...session, archivedAt: now, updatedAt: now }
      : session));
  }, []);

  const restoreSession = useCallback((id: string) => {
    const now = Date.now();
    setSessions((previous) => previous.map((session) => session.id === id
      ? { ...session, archivedAt: undefined, updatedAt: now }
      : session));
    if (workspace) setActiveByWorkspace((previous) => ({ ...previous, [workspace.path]: id }));
  }, [workspace]);

  const deleteSession = useCallback((id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setSessions((previous) => previous.filter((item) => item.id !== id));
    const persistenceKey = `${session.workspacePath}::${session.id}`;
    for (const storageKey of ['code-editor.ai-conversations.v1', 'code-editor.ai-pending.v1', 'code-editor.ai-drafts.v1']) {
      const stored = readStored<Record<string, unknown>>(storageKey, {});
      delete stored[persistenceKey];
      localStorage.setItem(storageKey, JSON.stringify(stored));
    }
    setLogsBySession((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    if (isDbReady()) { try { dbDeleteAgentSession(id); dbDeleteAgentLogs(id); } catch {} }
  }, [sessions]);

  const appendLog = useCallback((sessionId: string, level: AgentLogEntry['level'], message: string) => {
    setLogsBySession((previous) => ({
      ...previous,
      [sessionId]: [...(previous[sessionId] ?? []).slice(-499), createAgentLogEntry(level, message)],
    }));
  }, []);

  const clearLogs = useCallback((sessionId: string) => {
    setLogsBySession((previous) => ({ ...previous, [sessionId]: [] }));
  }, []);

  const forkSession = useCallback((id: string) => {
    const source = sessions.find((session) => session.id === id);
    if (!source || !workspace) return null;
    const fork = {
      ...createAgentSession(workspace),
      title: `${source.title}（分叉）`.slice(0, 80),
      validationTask: source.validationTask,
      validationTasks: source.validationTasks,
      autoValidate: source.autoValidate,
    };
    setSessions((previous) => [...previous, fork]);
    setActiveByWorkspace((previous) => ({ ...previous, [workspace.path]: fork.id }));
    const conversations = readStored<Record<string, unknown>>('code-editor.ai-conversations.v1', {});
    const sourceKey = `${source.workspacePath}::${source.id}`;
    const forkKey = `${fork.workspacePath}::${fork.id}`;
    if (conversations[sourceKey]) {
      conversations[forkKey] = conversations[sourceKey];
      localStorage.setItem('code-editor.ai-conversations.v1', JSON.stringify(conversations));
    }
    setLogsBySession((previous) => ({
      ...previous,
      [fork.id]: [createAgentLogEntry('info', `从会话“${source.title}”分叉；未复制待审修改和中断请求`)],
    }));
    return fork;
  }, [sessions, workspace]);

  return { sessions: visibleSessions, archivedSessions, activeSession, activeLogs, createSession, selectSession, updateSession, archiveSession, restoreSession, deleteSession, appendLog, clearLogs, forkSession };
}
