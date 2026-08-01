import { describe, expect, it } from 'vitest';
import { parseProblemLine, parseWorkspaceTasks, resolveTaskOrder } from '../src/main/workspace-tasks';

describe('workspace tasks', () => {
  it('parses lifecycle fields and quotes args', () => {
    const [task] = parseWorkspaceTasks({ tasks: [{ label: 'build', command: 'tsc', args: ['--project', 'folder name'], dependsOn: 'prepare', isBackground: true, problemMatcher: '$tsc', options: { env: { NODE_ENV: 'test' } } }] });
    expect(task).toMatchObject({ name: 'build', command: 'tsc --project "folder name"', dependsOn: ['prepare'], isBackground: true, problemMatcher: '$tsc', env: { NODE_ENV: 'test' } });
  });
  it('resolves dependencies and rejects cycles', () => {
    const tasks = parseWorkspaceTasks({ tasks: [{ label: 'prepare', command: 'a' }, { label: 'build', command: 'b', dependsOn: 'prepare' }] });
    expect(resolveTaskOrder(tasks, 'build').map((task) => task.name)).toEqual(['prepare', 'build']);
    expect(() => resolveTaskOrder(parseWorkspaceTasks({ tasks: [{ label: 'a', command: 'a', dependsOn: 'b' }, { label: 'b', command: 'b', dependsOn: 'a' }] }), 'a')).toThrow('TASK_DEPENDENCY_CYCLE');
  });
  it('parses built-in problem matchers', () => expect(parseProblemLine('src/a.ts(2,3): error TS1: broken', '$tsc')).toMatchObject({ path: 'src/a.ts', line: 2, column: 3, severity: 'error', message: 'broken' }));
});
