import { describe, expect, it } from 'vitest';
import { pathInAgentScope } from '../src/plugins/code-editor/agents/agent-edit-scope';

describe('Agent edit scope', () => {
  it('allows every relative path in workspace scope', () => {
    expect(pathInAgentScope('src/a.ts', { kind: 'workspace', paths: [], label: 'workspace' })).toBe(true);
  });

  it('allows only descendants of the selected directory', () => {
    const scope = { kind: 'directory' as const, paths: ['src/features'], label: 'features' };
    expect(pathInAgentScope('src/features/a.ts', scope)).toBe(true);
    expect(pathInAgentScope('src/feature-other/a.ts', scope)).toBe(false);
    expect(pathInAgentScope('tests/a.ts', scope)).toBe(false);
  });

  it('allows only explicitly selected files', () => {
    const scope = { kind: 'files' as const, paths: ['src/a.ts', 'src/b.ts'], label: '2 files' };
    expect(pathInAgentScope('src\\a.ts', scope)).toBe(true);
    expect(pathInAgentScope('src/c.ts', scope)).toBe(false);
  });
});
