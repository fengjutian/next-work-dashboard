import { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { TerminalProfile, TerminalTab } from '@/plugins/terminal/Terminal';
import type { WorkspaceTask, WorkspaceTaskEvent } from '@/types/electron';
import type { BottomPanelTab, EditorProblem } from '../editor-types';
import { displayError } from '../editor-types';
import { parseProblemLine, resolveTaskOrder } from '../../../main/workspace-tasks';

interface EditorTerminalTab extends TerminalTab { profile?: TerminalProfile }
type TaskState = 'running' | 'background' | 'completed' | 'failed' | 'cancelled';

interface UseTerminalTasksOptions {
  workspace: { path: string } | null;
  appPrompt: (title: string, defaultValue?: string) => Promise<string | null>;
  appendOutput: (message: string) => void;
  setStatus: (message: string) => void;
  setBottomPanel: React.Dispatch<React.SetStateAction<{ open: boolean; tab: BottomPanelTab; height: number }>>;
  onTaskEvent?: (event: WorkspaceTaskEvent) => void;
}

export function useTerminalTasks({ workspace, appPrompt, appendOutput, setStatus, setBottomPanel, onTaskEvent }: UseTerminalTasksOptions) {
  const counterRef = useRef(1);
  const activeMatcherRef = useRef<string>();
  const [taskProblems, setTaskProblems] = useState<EditorProblem[]>([]);
  const [workspaceTasks, setWorkspaceTasks] = useState<WorkspaceTask[]>([]);
  const [taskRun, setTaskRun] = useState<{ runId: string; name: string; state: TaskState; startedAt: number } | null>(null);
  const [taskHistory, setTaskHistory] = useState<Array<{ runId: string; name: string; state: 'completed' | 'failed' | 'cancelled'; startedAt: number; endedAt: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('code-editor.task-history') ?? '[]'); } catch { return []; }
  });
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>([]);
  const [terminalProfileName, setTerminalProfileName] = useState(() => localStorage.getItem('code-editor.terminal-profile') ?? '');
  const [terminalEnvText, setTerminalEnvText] = useState(() => localStorage.getItem('code-editor.terminal-env') ?? '');
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [renamingTerminalTitle, setRenamingTerminalTitle] = useState('');
  const [showEnvValues, setShowEnvValues] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<EditorTerminalTab[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('code-editor.terminal-tabs') ?? '[]') as Array<Pick<EditorTerminalTab, 'title' | 'cwd' | 'profile'>>;
      if (saved.length) return saved.slice(0, 8).map((tab, index) => ({ ...tab, id: `code-editor-terminal-${Date.now()}-${index}`, alive: true }));
    } catch { /* ignore invalid metadata */ }
    return [{ id: `code-editor-terminal-${Date.now()}`, title: 'Terminal 1', alive: true }];
  });
  const [activeTerminalId, setActiveTerminalId] = useState(() => terminalTabs[0].id);
  const [splitTerminalId, setSplitTerminalId] = useState<string | null>(null);

  const refreshTerminalProfiles = useCallback(async () => {
    let discovered: { data?: TerminalProfile[] } = {};
    try { discovered = await window.electronAPI.terminal.profiles(); } catch { /* IPC may not be ready */ }
    let custom: TerminalProfile[] = [];
    try { custom = JSON.parse(localStorage.getItem('code-editor.terminal-custom-profiles') ?? '[]'); } catch { /* ignore */ }
    const merged = [...(discovered.data ?? []), ...custom].filter((profile, index, all) => all.findIndex((item) => item.name === profile.name) === index);
    setTerminalProfiles(merged);
    setTerminalProfileName((current) => merged.some((profile) => profile.name === current) ? current : merged[0]?.name ?? '');
  }, []);

  const addTerminalProfile = useCallback(async () => {
    const name = await appPrompt('自定义终端 Profile 名称');
    const shell = name ? await appPrompt('Shell 可执行文件路径') : null;
    if (!name || !shell) return;
    const argsText = await appPrompt('启动参数（空格分隔，可留空）', '') ?? '';
    let custom: TerminalProfile[] = [];
    try { custom = JSON.parse(localStorage.getItem('code-editor.terminal-custom-profiles') ?? '[]'); } catch { /* ignore */ }
    const profile = { name: name.trim(), shell: shell.trim(), args: argsText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, '')) ?? [] };
    localStorage.setItem('code-editor.terminal-custom-profiles', JSON.stringify([...custom.filter((item) => item.name !== profile.name), profile]));
    await refreshTerminalProfiles();
    setTerminalProfileName(profile.name);
  }, [appPrompt, refreshTerminalProfiles]);

  const saveTerminalSecret = useCallback(async () => {
    const name = await appPrompt('Secret 名称（在环境变量中使用 ${secret:NAME}）');
    if (!name || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) return;
    const value = await appPrompt(`输入 ${name} 的 Secret 值`);
    if (!value) return;
    const saved = await window.electronAPI.auth.saveToken(`terminal-env:${name}`, value, 'Terminal environment secret');
    setStatus(saved ? `Secret ${name} 已安全保存` : 'Secret 保存失败：系统加密存储不可用');
  }, [appPrompt, setStatus]);

  const createTerminalTab = useCallback((split = false) => {
    const id = `code-editor-terminal-${Date.now()}-${++counterRef.current}`;
    const profile = terminalProfiles.find((item) => item.name === terminalProfileName);
    const env = Object.fromEntries(terminalEnvText.split(/\r?\n/).map((line) => line.split('=')).filter((parts) => parts.length >= 2).map(([key, ...value]) => [key.trim(), value.join('=').trim()]));
    setTerminalTabs((previous) => [...previous, { id, title: profile?.name ?? `Terminal ${counterRef.current}`, cwd: workspace?.path, alive: true, profile: profile ? { ...profile, env } : undefined }]);
    if (split) setSplitTerminalId(id); else setActiveTerminalId(id);
  }, [terminalEnvText, terminalProfileName, terminalProfiles, workspace?.path]);

  const closeTerminalTab = useCallback((id: string) => setTerminalTabs((previous) => {
    const remaining = previous.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const nextId = `code-editor-terminal-${Date.now()}-${++counterRef.current}`;
      setActiveTerminalId(nextId);
      return [{ id: nextId, title: `Terminal ${counterRef.current}`, cwd: workspace?.path, alive: true }];
    }
    if (activeTerminalId === id) setActiveTerminalId(remaining[0].id);
    if (splitTerminalId === id) setSplitTerminalId(null);
    return remaining;
  }), [activeTerminalId, splitTerminalId, workspace?.path]);

  const restartTerminalTab = useCallback((id: string) => {
    const nextId = `code-editor-terminal-${Date.now()}-${++counterRef.current}`;
    setTerminalTabs((previous) => previous.map((tab) => tab.id === id ? { ...tab, id: nextId, alive: true, exitCode: undefined } : tab));
    setActiveTerminalId(nextId);
  }, []);

  const handleTerminalOutput = useCallback((_id: string, data: string) => {
    // eslint-disable-next-line no-control-regex
    const clean = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
    const found: EditorProblem[] = [];
    for (const line of clean.split(/\r?\n/)) {
      const problem = parseProblemLine(line, activeMatcherRef.current);
      if (problem) found.push({ ...problem, severity: problem.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error });
    }
    if (found.length) setTaskProblems((previous) => [...previous.slice(-499), ...found]);
  }, []);

  const runWorkspaceTask = useCallback((taskName: string, rootPath = workspace?.path) => {
    const task = workspaceTasks.find((item) => item.name === taskName);
    if (!task || !rootPath) return null;
    setTaskProblems([]);
    try { resolveTaskOrder(workspaceTasks, task.name); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return null; }
    activeMatcherRef.current = task.problemMatcher;
    const runId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTaskRun({ runId, name: task.name, state: task.isBackground ? 'background' : 'running', startedAt: Date.now() });
    setBottomPanel((previous) => ({ ...previous, open: true, tab: 'terminal' }));
    const env = Object.fromEntries(terminalEnvText.split(/\r?\n/).map((line) => line.split('=')).filter((parts) => parts.length >= 2).map(([key, ...value]) => [key.trim(), value.join('=').trim()]));
    void window.electronAPI.workspace.runTask(rootPath, task.name, runId, env).then((result) => { if (!result.success) setStatus(`任务失败：${displayError(result.error)}`); });
    setStatus(`正在运行任务：${task.name}`);
    return runId;
  }, [setBottomPanel, setStatus, terminalEnvText, workspace?.path, workspaceTasks]);

  const cancelWorkspaceTask = useCallback(() => { if (taskRun) void window.electronAPI.workspace.cancelTask(taskRun.runId); }, [taskRun]);

  useEffect(() => window.electronAPI.workspace.onTaskEvent((event: WorkspaceTaskEvent) => {
    onTaskEvent?.(event);
    if (event.state === 'output' && event.output) { appendOutput(`[${event.task}] ${event.output.trimEnd()}`); handleTerminalOutput(event.runId, event.output); return; }
    if (event.state === 'started') setTaskRun((current) => current?.runId === event.runId ? { ...current, state: current.state === 'background' ? 'background' : 'running' } : current);
    if (event.state === 'completed' || event.state === 'failed' || event.state === 'cancelled') {
      const finalState: 'completed' | 'failed' | 'cancelled' = event.state;
      setTaskRun((current) => current?.runId === event.runId ? { ...current, state: finalState } : current);
      setTaskHistory((previous) => [...previous.slice(-49), { runId: event.runId, name: event.task, state: finalState, startedAt: event.startedAt, endedAt: event.endedAt ?? Date.now() }]);
      setStatus(finalState === 'completed' ? `任务完成：${event.task}` : finalState === 'cancelled' ? `任务已取消：${event.task}` : `任务失败：${event.task}`);
    }
  }), [appendOutput, handleTerminalOutput, onTaskEvent, setStatus]);

  useEffect(() => { void refreshTerminalProfiles(); }, [refreshTerminalProfiles]);
  useEffect(() => {
    localStorage.setItem('code-editor.terminal-profile', terminalProfileName);
    localStorage.setItem('code-editor.terminal-env', terminalEnvText);
    localStorage.setItem('code-editor.terminal-tabs', JSON.stringify(terminalTabs.map(({ title, cwd, profile }) => ({ title, cwd, profile }))));
  }, [terminalEnvText, terminalProfileName, terminalTabs]);
  useEffect(() => localStorage.setItem('code-editor.task-history', JSON.stringify(taskHistory.slice(-50))), [taskHistory]);
  useEffect(() => {
    if (!workspace) { setWorkspaceTasks([]); return; }
    void window.electronAPI.workspace.listTasks(workspace.path).then((result) => setWorkspaceTasks(result.data ?? [])).catch(() => undefined);
  }, [workspace]);

  return { taskProblems, workspaceTasks, taskRun, taskHistory, terminalProfiles, terminalProfileName, setTerminalProfileName, terminalEnvText, setTerminalEnvText, renamingTerminalId, setRenamingTerminalId, renamingTerminalTitle, setRenamingTerminalTitle, showEnvValues, setShowEnvValues, terminalTabs, setTerminalTabs, activeTerminalId, setActiveTerminalId, splitTerminalId, setSplitTerminalId, addTerminalProfile, saveTerminalSecret, createTerminalTab, closeTerminalTab, restartTerminalTab, handleTerminalOutput, runWorkspaceTask, cancelWorkspaceTask };
}
