import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceGitCommit, WorkspaceGitOperation, WorkspaceGitOverview, WorkspaceGitStatus } from '@/types/electron';
import { displayError } from './editor-types';

interface UseGitRepositoryOptions {
  workspace: { path: string } | null;
  sourceControlVisible: boolean;
  appendOutput: (message: string) => void;
  setStatus: (message: string) => void;
  openExternalDiff: (diff: { path: string; name: string; modified: string }) => void;
}

const GIT_ERRORS: Record<string, string> = {
  GIT_AUTH_REQUIRED: 'Git 凭据不可用，请检查 Git Credential Manager 或重新登录。',
  GIT_CERTIFICATE_ERROR: 'TLS 证书验证失败，请检查证书链、系统时间或企业 CA 配置。',
  GIT_PROXY_ERROR: 'Git 代理连接失败，请检查 http.proxy/https.proxy 和代理凭据。',
  GIT_NETWORK_ERROR: '网络连接失败，请检查 DNS、网络和远端服务状态。',
  GIT_REPOSITORY_NOT_FOUND: '远端仓库不存在，或当前账号无权查看。',
  GIT_SSH_AGENT_ERROR: 'SSH Agent 不可用，请启动 Agent 并加载私钥。',
  GIT_PERMISSION_DENIED: 'Git 权限被拒绝，请检查 SSH Key、仓库权限或访问令牌。',
  GIT_INDEX_LOCKED: 'Git 索引被锁定，请确认没有其他 Git 进程正在运行。',
  GIT_SAFE_DIRECTORY: 'Git 拒绝了仓库所有权，请核对目录所有者和 safe.directory 配置。',
  GIT_CONFLICT: '操作产生冲突，请在冲突列表中解决后继续。',
};

export function useGitRepository({ workspace, sourceControlVisible, appendOutput, setStatus, openExternalDiff }: UseGitRepositoryOptions) {
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus[]>([]);
  const [gitOverview, setGitOverview] = useState<WorkspaceGitOverview | null>(null);
  const [gitHistory, setGitHistory] = useState<WorkspaceGitCommit[]>([]);
  const [gitView, setGitView] = useState<'changes' | 'history' | 'stash'>('changes');
  const [gitBusy, setGitBusy] = useState<{ operation: string; operationId: string } | null>(null);
  const [pullStrategy, setPullStrategy] = useState<'ff-only' | 'merge' | 'rebase'>('ff-only');
  const [commitMessage, setCommitMessage] = useState('');

  const refreshGitStatus = useCallback(async () => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitStatus(workspace.path);
    if (result.success) setGitStatus(result.data ?? []);
    else { setGitStatus([]); appendOutput(`Git 状态读取失败：${displayError(result.error)}`); }
  }, [appendOutput, workspace]);

  const refreshGitOverview = useCallback(async () => {
    if (!workspace) return;
    try {
      const [overview, history] = await Promise.all([
        window.electronAPI.workspace.gitOperation<WorkspaceGitOverview>(workspace.path, 'overview'),
        window.electronAPI.workspace.gitOperation<WorkspaceGitCommit[]>(workspace.path, 'log', { limit: 100 }),
      ]);
      if (overview.success) setGitOverview(overview.data ?? null);
      if (history.success) setGitHistory(history.data ?? []);
    } catch { /* IPC may not be registered yet */ }
  }, [workspace]);

  const runGitOperation = useCallback(async (operation: WorkspaceGitOperation, payload?: Record<string, unknown>) => {
    if (!workspace) return false;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, operation, payload);
    if (!result.success) {
      const message = GIT_ERRORS[result.error ?? ''] ?? displayError(result.error);
      setStatus(message);
      appendOutput(`${operation} 失败：${message}`);
      return false;
    }
    if (typeof result.data === 'string' && result.data) appendOutput(result.data);
    await Promise.all([refreshGitStatus(), refreshGitOverview()]);
    return true;
  }, [appendOutput, refreshGitOverview, refreshGitStatus, setStatus, workspace]);

  const loadGitHistory = useCallback(async (filters: { query?: string; author?: string; since?: string; until?: string }, append = false) => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitOperation<WorkspaceGitCommit[]>(workspace.path, 'log', { ...filters, limit: 50, skip: append ? gitHistory.length : 0 });
    if (result.success) setGitHistory((previous) => append ? [...previous, ...(result.data ?? [])] : result.data ?? []);
    else setStatus(`Git 历史读取失败：${displayError(result.error)}`);
  }, [gitHistory.length, setStatus, workspace]);

  const compareGitCommits = useCallback(async (from: string, to: string) => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitOperation<string>(workspace.path, 'compareCommits', { from, to });
    if (!result.success) { setStatus(`提交比较失败：${displayError(result.error)}`); return; }
    openExternalDiff({ path: `${from}..${to}`, name: `${from.slice(0, 7)}..${to.slice(0, 7)}`, modified: result.data ?? '' });
  }, [openExternalDiff, setStatus, workspace]);

  const cancelGitOp = useCallback(() => { if (workspace && gitBusy) void window.electronAPI.workspace.cancelGitOperation(workspace.path, gitBusy.operationId); }, [gitBusy, workspace]);

  useEffect(() => window.electronAPI.workspace.onGitProgress((event) => {
    setGitBusy(event.state === 'started' ? { operation: event.operation, operationId: event.operationId } : null);
    setStatus(event.message);
  }), [setStatus]);

  useEffect(() => {
    if (!workspace || !sourceControlVisible) return;
    void Promise.all([refreshGitStatus(), refreshGitOverview()]);
  }, [refreshGitOverview, refreshGitStatus, sourceControlVisible, workspace]);

  return { gitStatus, setGitStatus, gitOverview, gitHistory, setGitHistory, gitView, setGitView, gitBusy, pullStrategy, setPullStrategy, commitMessage, setCommitMessage, refreshGitStatus, refreshGitOverview, runGitOperation, loadGitHistory, compareGitCommits, cancelGitOp };
}
