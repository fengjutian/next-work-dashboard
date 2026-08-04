import { describe, expect, it } from 'vitest';
import { createAgentSession, sessionsForWorkspace, type AgentSession } from '../src/plugins/code-editor/agent-sessions';

describe('agent sessions', () => {
  it('creates a workspace-bound idle session', () => {
    const session = createAgentSession({ path: 'C:/work/app', name: 'app' }, 100);
    expect(session).toMatchObject({
      workspacePath: 'C:/work/app', workspaceName: 'app', status: 'idle', createdAt: 100, updatedAt: 100,
    });
    expect(session.id).toContain('agent-100-');
  });

  it('filters archived and unrelated sessions and sorts newest first', () => {
    const base: Omit<AgentSession, 'id' | 'workspacePath' | 'updatedAt'> = {
      workspaceName: 'app', title: 'task', status: 'idle', createdAt: 1, filesChanged: 0, accepted: 0,
    };
    const sessions: AgentSession[] = [
      { ...base, id: 'old', workspacePath: '/app', updatedAt: 10 },
      { ...base, id: 'new', workspacePath: '/app', updatedAt: 20 },
      { ...base, id: 'archived', workspacePath: '/app', updatedAt: 30, archivedAt: 30 },
      { ...base, id: 'other', workspacePath: '/other', updatedAt: 40 },
    ];
    expect(sessionsForWorkspace(sessions, '/app').map((session) => session.id)).toEqual(['new', 'old']);
  });
});

