/**
 * useTasks — Workspace 内 Task 状态管理
 */
import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus, WorkspaceId } from '../../../core/work-browser/types';

export function useTasks(workspaceId: WorkspaceId | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) { setTasks([]); return; }
    try {
      setLoading(true);
      const data = (await window.electronAPI.workBrowser.task.list(workspaceId)) as Task[];
      setTasks(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upsert = useCallback(async (task: Task) => {
    await window.electronAPI.workBrowser.task.upsert(task);
    await refresh();
  }, [refresh]);

  const setStatus = useCallback(async (task: Task, status: TaskStatus) => {
    await upsert({ ...task, status, updatedAt: Date.now(), resolvedAt: status === 'resolved' ? Date.now() : task.resolvedAt });
  }, [upsert]);

  const updateStep = useCallback(async (
    task: Task,
    stepId: string,
    patch: { status?: 'pending' | 'in-progress' | 'done' | 'failed' | 'skipped'; result?: string; evidence?: string },
  ) => {
    const updated: Task = {
      ...task,
      steps: task.steps.map((s) => s.id === stepId ? { ...s, ...patch } : s),
      updatedAt: Date.now(),
    };
    await upsert(updated);
  }, [upsert]);

  const createFromTemplate = useCallback(async (templateId: string, title?: string) => {
    if (!workspaceId) return null;
    const task = (await window.electronAPI.workBrowser.task.createFromTemplate({ workspaceId, templateId, title })) as Task;
    await refresh();
    return task;
  }, [workspaceId, refresh]);

  const runAuto = useCallback(async (taskId: string): Promise<Task | null> => {
    try {
      const final = (await window.electronAPI.workBrowser.task.runAuto(taskId)) as Task;
      await refresh();
      return final;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [refresh]);

  return { tasks, loading, error, refresh, upsert, setStatus, updateStep, createFromTemplate, runAuto };
}
