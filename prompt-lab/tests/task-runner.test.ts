import { describe, expect, it } from 'vitest';
import { WorkspaceTaskRunner } from '../src/main/task-runner';
import type { WorkspaceTaskDefinition } from '../src/main/workspace-tasks';

const task = (name: string, command: string, dependsOn: string[] = [], dependsOrder: 'sequence' | 'parallel' = 'sequence'): WorkspaceTaskDefinition => ({ name, command, detail: 'test', dependsOn, dependsOrder, isBackground: false });
const nodeCommand = (script: string) => `"${process.execPath}" -e ${JSON.stringify(script)}`;

describe('WorkspaceTaskRunner', () => {
  it('streams output and completes from the real exit code', async () => {
    const events: string[] = [];
    const output: string[] = [];
    const runner = new WorkspaceTaskRunner();
    const result = await runner.run('run-1', [task('ok', nodeCommand("process.stdout.write('hello')"))], 'ok', process.cwd(), process.env as Record<string, string>, (event) => { events.push(event.state); if (event.output) output.push(event.output); });
    expect(result.exitCode).toBe(0);
    expect(events[0]).toBe('started');
    expect(events.at(-1)).toBe('completed');
    expect(events).toContain('output');
    expect(output.join('')).toContain('hello');
  });

  it('reports a failed non-zero task', async () => {
    const states: string[] = [];
    const runner = new WorkspaceTaskRunner();
    await expect(runner.run('run-2', [task('bad', nodeCommand('process.exit(3)'))], 'bad', process.cwd(), process.env as Record<string, string>, (event) => { states.push(event.state); })).rejects.toThrow('TASK_EXIT_CODE:3:bad');
    expect(states.at(-1)).toBe('failed');
  });
});
