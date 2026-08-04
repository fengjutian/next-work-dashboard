import { useCallback, useEffect, useMemo, useState } from 'react';
import { archivedSessionsForWorkspace, createAgentSession, sessionsForWorkspace, type AgentSession } from './agent-sessions';

const STORAGE_KEY = 'code-editor.agent-sessions.v1';
const ACTIVE_KEY = 'code-editor.active-agent-sessions.v1';

function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

export function useAgentSessions(workspace: { path: string; name: string } | null) {
  const [sessions, setSessions] = useState<AgentSession[]>(() => readStored(STORAGE_KEY, []));
  const [activeByWorkspace, setActiveByWorkspace] = useState<Record<string, string>>(() => readStored(ACTIVE_KEY, {}));
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

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-200))), [sessions]);
  useEffect(() => localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeByWorkspace)), [activeByWorkspace]);
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
  }, [sessions]);

  return { sessions: visibleSessions, archivedSessions, activeSession, createSession, selectSession, updateSession, archiveSession, restoreSession, deleteSession };
}
