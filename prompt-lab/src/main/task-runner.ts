import { spawn, type ChildProcess } from 'node:child_process';
import type { WorkspaceTaskDefinition } from './workspace/tasks';

export interface TaskRunEvent {
  runId: string;
  task: string;
  state: 'started' | 'output' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
}

export interface TaskRunResult { runId: string; task: string; exitCode: number; startedAt: number; endedAt: number }

export class WorkspaceTaskRunner {
  private children = new Map<string, Set<ChildProcess>>();

  async run(runId: string, tasks: WorkspaceTaskDefinition[], target: string, cwd: string, baseEnv: Record<string, string>, emit: (event: TaskRunEvent) => void): Promise<TaskRunResult> {
    const byName = new Map(tasks.map((task) => [task.name, task]));
    const completed = new Set<string>();
    const active = new Set<string>();
    const startedAt = Date.now();
    this.children.set(runId, new Set());
    emit({ runId, task: target, state: 'started', startedAt });

    const execute = async (name: string): Promise<void> => {
      if (completed.has(name)) return;
      if (active.has(name)) throw new Error(`TASK_DEPENDENCY_CYCLE:${name}`);
      const task = byName.get(name);
      if (!task) throw new Error(`TASK_DEPENDENCY_NOT_FOUND:${name}`);
      active.add(name);
      if (task.dependsOrder === 'sequence') {
        for (const dependency of task.dependsOn) await execute(dependency);
      } else {
        await Promise.all(task.dependsOn.map(execute));
      }
      active.delete(name);
      if (completed.has(name)) return;
      await this.spawnTask(runId, task, cwd, { ...baseEnv, ...(task.env ?? {}) }, startedAt, emit);
      completed.add(name);
    };

    try {
      await execute(target);
      const endedAt = Date.now();
      emit({ runId, task: target, state: 'completed', exitCode: 0, startedAt, endedAt });
      return { runId, task: target, exitCode: 0, startedAt, endedAt };
    } catch (error) {
      const endedAt = Date.now();
      const cancelled = error instanceof Error && error.message === 'TASK_CANCELLED';
      emit({ runId, task: target, state: cancelled ? 'cancelled' : 'failed', exitCode: cancelled ? -1 : 1, output: cancelled ? undefined : error instanceof Error ? error.message : String(error), startedAt, endedAt });
      throw error;
    } finally {
      this.children.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const children = this.children.get(runId);
    if (!children) return false;
    for (const child of children) child.kill();
    return true;
  }

  private spawnTask(runId: string, task: WorkspaceTaskDefinition, cwd: string, env: Record<string, string>, startedAt: number, emit: (event: TaskRunEvent) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(task.command, { cwd, env, shell: true, windowsHide: true });
      this.children.get(runId)?.add(child);
      const output = (chunk: unknown) => emit({ runId, task: task.name, state: 'output', output: String(chunk), startedAt });
      child.stdout?.on('data', output);
      child.stderr?.on('data', output);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        this.children.get(runId)?.delete(child);
        if (signal) reject(new Error('TASK_CANCELLED'));
        else if (code === 0) resolve();
        else reject(new Error(`TASK_EXIT_CODE:${code ?? 1}:${task.name}`));
      });
    });
  }
}
