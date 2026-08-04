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
  validationTask?: string;
  validationTasks?: string[];
  autoValidate?: boolean;
  pinned?: boolean;
}

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
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
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.updatedAt - left.updatedAt);
}

export function archivedSessionsForWorkspace(sessions: AgentSession[], workspacePath?: string): AgentSession[] {
  if (!workspacePath) return [];
  return sessions
    .filter((session) => session.workspacePath === workspacePath && Boolean(session.archivedAt))
    .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
}

export function titleFromInstruction(instruction: string, maxLength = 50): string {
  const firstLine = instruction.split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim();
  return firstLine.slice(0, maxLength) || 'Agent 任务';
}

export function createAgentLogEntry(
  level: AgentLogEntry['level'],
  message: string,
  timestamp = Date.now(),
): AgentLogEntry {
  return { id: `log-${timestamp}-${Math.random().toString(36).slice(2, 7)}`, timestamp, level, message };
}
