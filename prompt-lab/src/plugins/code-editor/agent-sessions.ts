export type AgentSessionStatus = 'idle' | 'running' | 'review' | 'completed' | 'interrupted';

export interface AgentSession {
  id: string;
  workspacePath: string;
  workspaceName: string;
  title: string;
  status: AgentSessionStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  filesChanged: number;
  accepted: number;
}

export function createAgentSession(
  workspace: { path: string; name: string },
  now = Date.now(),
): AgentSession {
  return {
    id: `agent-${now}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    title: '新 Agent 会话',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    filesChanged: 0,
    accepted: 0,
  };
}

export function sessionsForWorkspace(sessions: AgentSession[], workspacePath?: string): AgentSession[] {
  if (!workspacePath) return [];
  return sessions
    .filter((session) => session.workspacePath === workspacePath && !session.archivedAt)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function archivedSessionsForWorkspace(sessions: AgentSession[], workspacePath?: string): AgentSession[] {
  if (!workspacePath) return [];
  return sessions
    .filter((session) => session.workspacePath === workspacePath && Boolean(session.archivedAt))
    .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
}
