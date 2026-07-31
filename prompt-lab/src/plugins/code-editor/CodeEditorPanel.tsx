import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor, loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import {
  ChevronDown,
  Code,
  FileText,
  FolderOpen,
  Edit3,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { TerminalSingle, type TerminalTab, type TerminalProfile } from '@/components/Terminal';
import { useStore } from '@/store';
import { createOpenAIProvider } from '@/core/llm';
import type {
  FilePickResult,
  WorkspaceEncoding,
  WorkspaceGitStatus,
  WorkspaceGitOverview,
  WorkspaceGitCommit,
  WorkspaceGitOperation,
  WorkspaceSearchResult,
} from '@/types/electron';
import { decodeBase64Utf8, languageFromName, languageIdFromName } from './editor-utils';
import { FileTreeRow } from './FileTreeRow';
import { SearchPanel } from './SearchPanel';
import { QuickOpenPanel } from './QuickOpenPanel';
import {
  type BottomPanelTab,
  type EditorPreferences,
  type EditorProblem,
  type EditorSymbol,
  type OpenDocument,
  type TreeNode,
  type TreeEditState,
  DEFAULT_PREFERENCES,
  displayError,
  encodingLabel,
} from './editor-types';

export { decodeBase64Utf8, languageFromName, languageIdFromName } from './editor-utils';
export { type BottomPanelTab, type EditorPreferences, type EditorProblem, type EditorSymbol, type OpenDocument, type TreeNode, type TreeEditState, DEFAULT_PREFERENCES, displayError, encodingLabel } from './editor-types';

loader.config({ monaco });
if (typeof self !== 'undefined') {
  (self as typeof self & {
    MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
  }).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') return new JsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
      if (label === 'typescript' || label === 'javascript') return new TsWorker();
      return new EditorWorker();
    },
  };
}

function updateTreeNode(nodes: TreeNode[], path: string, update: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return update(node);
    if (node.children) return { ...node, children: updateTreeNode(node.children, path, update) };
    return node;
  });
}

interface GitHunk { label: string; patch: string }
interface AiFileProposal { path: string; original: string; modified: string; language: string; metadata?: OpenDocument }
interface AiEditHistory { id: number; path: string; before: string; after: string }
interface EditorTerminalTab extends TerminalTab { profile?: TerminalProfile }
interface ReplaceSnapshot { path: string; content: string; encoding: WorkspaceEncoding; lineEnding: 'LF' | 'CRLF' }

function extractGitHunks(patchText: string): GitHunk[] {
  const lines = patchText.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunk < 0) return [];
  const header = lines.slice(0, firstHunk).join('\n');
  const hunks: GitHunk[] = [];
  let start = firstHunk;
  for (let index = firstHunk + 1; index <= lines.length; index += 1) {
    if (index === lines.length || lines[index].startsWith('@@')) {
      const hunkLines = lines.slice(start, index);
      hunks.push({ label: hunkLines[0], patch: `${header}\n${hunkLines.join('\n')}\n` });
      start = index;
    }
  }
  return hunks;
}

export const CodeEditorPanel: React.FC = () => {
  const { theme, aiApi } = useStore();
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const [workspace, setWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [treeEdit, setTreeEdit] = useState<TreeEditState | null>(null);
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [treeClipboard, setTreeClipboard] = useState<{ node: TreeNode; cut: boolean } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [secondaryPath, setSecondaryPath] = useState<string | null>(null);
  const [diffView, setDiffView] = useState<{
    path: string;
    name: string;
    original: string;
    modified: string;
    language: string;
    source?: 'external' | 'git' | 'merge' | 'ai';
  } | null>(null);
  const [gitHunks, setGitHunks] = useState<GitHunk[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(180, Math.min(520, Number(localStorage.getItem('code-editor.sidebar-width')) || 240)));
  const [autoSave, setAutoSave] = useState(false);
  const [preferences, setPreferences] = useState<EditorPreferences>(() => {
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(localStorage.getItem('code-editor.preferences.v1') ?? '{}') };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });
  const [bottomPanel, setBottomPanel] = useState<{ open: boolean; tab: BottomPanelTab; height: number }>({
    open: false, tab: 'problems', height: 220,
  });
  const [problems, setProblems] = useState<EditorProblem[]>([]);
  const [symbols, setSymbols] = useState<EditorSymbol[]>([]);
  const [outputLines, setOutputLines] = useState<string[]>(['代码编辑器已就绪']);
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus[]>([]);
  const [gitOverview, setGitOverview] = useState<WorkspaceGitOverview | null>(null);
  const [gitHistory, setGitHistory] = useState<WorkspaceGitCommit[]>([]);
  const [gitView, setGitView] = useState<'changes' | 'history' | 'stash'>('changes');
  const [gitBusy, setGitBusy] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiEditing, setAiEditing] = useState(false);
  const [aiMultiFile, setAiMultiFile] = useState(false);
  const [aiProposals, setAiProposals] = useState<AiFileProposal[]>([]);
  const [aiHistory, setAiHistory] = useState<AiEditHistory[]>([]);
  const terminalCounterRef = useRef(1);
  const terminalProfiles = useMemo<TerminalProfile[]>(() => navigator.userAgent.includes('Win') ? [
    { name: 'PowerShell', shell: 'powershell.exe' }, { name: 'cmd', shell: 'cmd.exe' }, { name: 'Git Bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['-i'] },
  ] : [{ name: 'zsh', shell: '/bin/zsh' }, { name: 'bash', shell: '/bin/bash' }, { name: 'fish', shell: '/usr/bin/fish' }], []);
  const [terminalProfileName, setTerminalProfileName] = useState(() => localStorage.getItem('code-editor.terminal-profile') ?? terminalProfiles[0]?.name ?? '');
  const [terminalEnvText, setTerminalEnvText] = useState(() => localStorage.getItem('code-editor.terminal-env') ?? '');
  const [terminalTabs, setTerminalTabs] = useState<EditorTerminalTab[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('code-editor.terminal-tabs') ?? '[]') as Array<Pick<EditorTerminalTab, 'title' | 'cwd' | 'profile'>>;
      if (saved.length > 0) return saved.slice(0, 8).map((tab, index) => ({ ...tab, id: `code-editor-terminal-${Date.now()}-${index}`, alive: true }));
    } catch { /* ignore invalid persisted terminal metadata */ }
    return [{ id: `code-editor-terminal-${Date.now()}`, title: 'Terminal 1', alive: true }];
  });
  const [activeTerminalId, setActiveTerminalId] = useState(() => terminalTabs[0].id);
  const [splitTerminalId, setSplitTerminalId] = useState<string | null>(null);
  const [status, setStatus] = useState('就绪');
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; query: string; files: TreeNode[] }>({
    open: false, query: '', files: [],
  });
  const [searchPanel, setSearchPanel] = useState<{
    open: boolean;
    query: string;
    replacement: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    include: string;
    exclude: string;
    loading: boolean;
    results: WorkspaceSearchResult[];
  }>({ open: false, query: '', replacement: '', caseSensitive: false, wholeWord: false, useRegex: false, include: '', exclude: '', loading: false, results: [] });
  const [replaceHistory, setReplaceHistory] = useState<ReplaceSnapshot[][]>([]);
  const restoringRef = useRef(true);
  const documentsRef = useRef<OpenDocument[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const gitDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const recentlySavedRef = useRef(new Map<string, number>());
  const openRequestRef = useRef(0);
  const viewStatesRef = useRef<Record<string, monaco.editor.ICodeEditorViewState | null>>({});

  const appendOutput = useCallback((message: string) => {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    setOutputLines((previous) => [...previous.slice(-199), line]);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitStatus(workspace.path);
    if (result.success) setGitStatus(result.data ?? []);
    else {
      setGitStatus([]);
      appendOutput(`Git 状态读取失败：${displayError(result.error)}`);
    }
  }, [appendOutput, workspace]);

  const refreshGitOverview = useCallback(async () => {
    if (!workspace) return;
    const [overview, history] = await Promise.all([
      window.electronAPI.workspace.gitOperation<WorkspaceGitOverview>(workspace.path, 'overview'),
      window.electronAPI.workspace.gitOperation<WorkspaceGitCommit[]>(workspace.path, 'log', { limit: 100 }),
    ]);
    if (overview.success) setGitOverview(overview.data ?? null);
    if (history.success) setGitHistory(history.data ?? []);
  }, [workspace]);

  const runGitOperation = useCallback(async (operation: WorkspaceGitOperation, payload?: Record<string, unknown>) => {
    if (!workspace) return false;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, operation, payload);
    if (!result.success) {
      const message = result.error === 'GIT_AUTH_REQUIRED' ? 'Git 凭据不可用，请在系统凭据管理器或终端中完成登录' : result.error === 'GIT_CONFLICT' ? '操作产生冲突，请在冲突列表中解决后继续' : displayError(result.error);
      setStatus(message);
      appendOutput(`${operation} 失败：${message}`);
      return false;
    }
    if (typeof result.data === 'string' && result.data) appendOutput(result.data);
    await Promise.all([refreshGitStatus(), refreshGitOverview()]);
    return true;
  }, [appendOutput, refreshGitOverview, refreshGitStatus, workspace]);

  const createTerminalTab = useCallback((split = false) => {
    terminalCounterRef.current += 1;
    const id = `code-editor-terminal-${Date.now()}-${terminalCounterRef.current}`;
    const profile = terminalProfiles.find((item) => item.name === terminalProfileName);
    const env = Object.fromEntries(terminalEnvText.split(/\r?\n/).map((line) => line.split('=')).filter((parts) => parts.length >= 2).map(([key, ...value]) => [key.trim(), value.join('=').trim()]));
    setTerminalTabs((previous) => [...previous, { id, title: profile?.name ?? `Terminal ${terminalCounterRef.current}`, cwd: workspace?.path, alive: true, profile: profile ? { ...profile, env } : undefined }]);
    if (split) setSplitTerminalId(id); else setActiveTerminalId(id);
  }, [terminalEnvText, terminalProfileName, terminalProfiles, workspace?.path]);

  const closeTerminalTab = useCallback((id: string) => {
    setTerminalTabs((previous) => {
      const remaining = previous.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const nextId = `code-editor-terminal-${Date.now()}-${++terminalCounterRef.current}`;
        setActiveTerminalId(nextId);
        return [{ id: nextId, title: `Terminal ${terminalCounterRef.current}`, cwd: workspace?.path, alive: true }];
      }
      if (activeTerminalId === id) setActiveTerminalId(remaining[0].id);
      if (splitTerminalId === id) setSplitTerminalId(null);
      return remaining;
    });
  }, [activeTerminalId, splitTerminalId, workspace?.path]);

  const restartTerminalTab = useCallback((id: string) => {
    const nextId = `code-editor-terminal-${Date.now()}-${++terminalCounterRef.current}`;
    setTerminalTabs((previous) => previous.map((tab) => tab.id === id ? {
      ...tab, id: nextId, title: tab.title, alive: true, exitCode: undefined,
    } : tab));
    setActiveTerminalId(nextId);
  }, []);

  const activeDocument = documents.find((document) => document.path === activePath) ?? null;
  const secondaryDocument = documents.find((document) => document.path === secondaryPath) ?? null;
  const hasDirtyDocuments = documents.some((document) => document.content !== document.savedContent);
  const visibleTreeNodes = useMemo(() => {
    const result: TreeNode[] = [];
    const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
      result.push(node);
      if (node.children) visit(node.children);
    });
    visit(tree);
    return result;
  }, [tree]);
  const treeDecorations = useMemo(() => {
    const result = new Map<string, { git?: string; errors?: number; warnings?: number }>();
    for (const entry of gitStatus) {
      const path = visibleTreeNodes.find((node) => node.path.replace(/\\/g, '/') === entry.path.replace(/\\/g, '/'))?.path ?? entry.path;
      result.set(path, { ...result.get(path), git: entry.status });
    }
    for (const problem of problems) {
      const path = [...visibleTreeNodes].find((node) => problem.path.replace(/\\/g, '/').endsWith(node.path.replace(/\\/g, '/')))?.path;
      if (!path) continue;
      const current = result.get(path) ?? {};
      if (problem.severity === monaco.MarkerSeverity.Error) current.errors = (current.errors ?? 0) + 1;
      else if (problem.severity === monaco.MarkerSeverity.Warning) current.warnings = (current.warnings ?? 0) + 1;
      result.set(path, current);
    }
    return result;
  }, [gitStatus, problems, visibleTreeNodes]);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const loadDirectory = useCallback(async (rootPath: string, relativePath = '') => {
    const result = await window.electronAPI.workspace.listDirectory(rootPath, relativePath);
    if (!result.success) throw new Error(displayError(result.error));
    return (result.data ?? []) as TreeNode[];
  }, []);

  const selectTreeNode = useCallback((node: TreeNode, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    if (event?.shiftKey && selectedNode) {
      const anchor = visibleTreeNodes.findIndex((item) => item.path === selectedNode.path);
      const target = visibleTreeNodes.findIndex((item) => item.path === node.path);
      if (anchor >= 0 && target >= 0) {
        const [start, end] = anchor < target ? [anchor, target] : [target, anchor];
        setSelectedPaths(new Set(visibleTreeNodes.slice(start, end + 1).map((item) => item.path)));
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelectedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
        return next;
      });
    } else {
      setSelectedPaths(new Set([node.path]));
    }
    setSelectedNode(node);
  }, [selectedNode, visibleTreeNodes]);

  const hydrateExpandedTree = useCallback(async (
    rootPath: string,
    nodes: TreeNode[],
    paths: Set<string>,
  ): Promise<TreeNode[]> => Promise.all(nodes.map(async (node) => {
    if (node.type !== 'directory' || !paths.has(node.path)) return node;
    const children = await loadDirectory(rootPath, node.path);
    return { ...node, children: await hydrateExpandedTree(rootPath, children, paths) };
  })), [loadDirectory]);

  const refreshWorkspaceTree = useCallback(async () => {
    if (!workspace) return;
    const entries = await loadDirectory(workspace.path);
    setTree(await hydrateExpandedTree(workspace.path, entries, expandedPaths));
  }, [expandedPaths, hydrateExpandedTree, loadDirectory, workspace]);

  const remapOpenPaths = useCallback((oldPath: string, nextPath: string) => {
    setDocuments((previous) => previous.map((document) => {
      if (
        document.path !== oldPath
        && !document.path.startsWith(`${oldPath}\\`)
        && !document.path.startsWith(`${oldPath}/`)
      ) return document;
      const path = `${nextPath}${document.path.slice(oldPath.length)}`;
      return { ...document, path, name: path.split(/[\\/]/).pop() ?? document.name };
    }));
    setActivePath((current) => {
      if (!current) return current;
      if (current !== oldPath && !current.startsWith(`${oldPath}\\`) && !current.startsWith(`${oldPath}/`)) {
        return current;
      }
      return `${nextPath}${current.slice(oldPath.length)}`;
    });
  }, []);

  const revealWorkspacePath = useCallback(async (relativePath: string) => {
    if (!workspace) return;
    const parts = relativePath.split(/[\\/]/);
    const separator = relativePath.includes('\\') ? '\\' : '/';
    const nextExpanded = new Set(expandedPaths);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}${separator}${part}` : part;
      nextExpanded.add(current);
    }
    setExpandedPaths(nextExpanded);
    const entries = await loadDirectory(workspace.path);
    setTree(await hydrateExpandedTree(workspace.path, entries, nextExpanded));
  }, [expandedPaths, hydrateExpandedTree, loadDirectory, workspace]);

  const openWorkspace = useCallback(async () => {
    if (hasDirtyDocuments && !window.confirm('当前工作区有未保存的修改，仍要打开其他文件夹吗？')) return;
    try {
      const folder = await window.electronAPI.workspace.openFolder();
      if (!folder) return;
      setStatus('正在读取工作区…');
      const entries = await loadDirectory(folder.path);
      setWorkspace(folder);
      setTree(entries);
      setDocuments([]);
      setActivePath(null);
      setExpandedPaths(new Set());
      setSelectedNode(null);
      setStatus(`已打开 ${folder.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(
        message.includes('No handler registered')
          ? '主进程版本过旧，请完全退出并重新启动应用'
          : `工作区打开失败：${message}`,
      );
    }
  }, [hasDirtyDocuments, loadDirectory]);

  const beginCreate = useCallback((type: 'file' | 'directory') => {
    if (!workspace) return;
    setTreeEdit({ mode: type === 'file' ? 'create-file' : 'create-directory', value: '' });
  }, [workspace]);

  const beginRename = useCallback((node = selectedNode) => {
    if (!node) return;
    setSelectedNode(node);
    setTreeEdit({ mode: 'rename', value: node.name, target: node });
    setTreeMenu(null);
  }, [selectedNode]);

  const commitTreeEdit = useCallback(async () => {
    if (!workspace || !treeEdit?.value.trim()) {
      setTreeEdit(null);
      return;
    }
    if (treeEdit.mode !== 'rename') {
      const parent = selectedNode?.type === 'directory' ? selectedNode.path : '';
      const relativePath = parent ? `${parent}/${treeEdit.value.trim()}` : treeEdit.value.trim();
      const result = treeEdit.mode === 'create-file'
        ? await window.electronAPI.workspace.createFile(workspace.path, relativePath)
        : await window.electronAPI.workspace.createDirectory(workspace.path, relativePath);
      if (!result.success) {
        setStatus(`新建失败：${displayError(result.error)}`);
        return;
      }
      setTreeEdit(null);
      await refreshWorkspaceTree();
      setStatus(`已新建 ${relativePath}`);
      return;
    }
    const target = treeEdit.target;
    if (!target || treeEdit.value.trim() === target.name) {
      setTreeEdit(null);
      return;
    }
    const parent = target.path.replace(/[\\/][^\\/]+$/, '');
    const nextName = treeEdit.value.trim();
    const nextPath = parent ? `${parent}/${nextName}` : nextName;
    const result = await window.electronAPI.workspace.renameEntry(
      workspace.path, target.path, nextPath,
    );
    if (!result.success) {
      setStatus(`重命名失败：${displayError(result.error)}`);
      return;
    }
    const oldPath = target.path;
    remapOpenPaths(oldPath, nextPath);
    setSelectedNode(null);
    setTreeEdit(null);
    await refreshWorkspaceTree();
    setStatus(`已重命名为 ${nextName}`);
  }, [refreshWorkspaceTree, remapOpenPaths, selectedNode, treeEdit, workspace]);

  const deleteSelected = useCallback(async (node = selectedNode) => {
    if (!workspace || !node) return;
    const affectedDocuments = documents.filter((document) => (
      document.path === node.path
      || document.path.startsWith(`${node.path}\\`)
      || document.path.startsWith(`${node.path}/`)
    ));
    if (affectedDocuments.some((document) => document.content !== document.savedContent)) {
      setStatus('删除目标中包含未保存文件，请先保存或关闭');
      return;
    }
    if (!window.confirm(`确定将“${node.name}”移到系统回收站吗？`)) return;
    const result = await window.electronAPI.workspace.trashEntry(workspace.path, node.path);
    if (!result.success) {
      setStatus(`删除失败：${displayError(result.error)}`);
      return;
    }
    const affectedPaths = new Set(affectedDocuments.map((document) => document.path));
    const remaining = documents.filter((document) => !affectedPaths.has(document.path));
    setDocuments(remaining);
    if (secondaryPath && affectedPaths.has(secondaryPath)) setSecondaryPath(null);
    if (activePath && affectedPaths.has(activePath)) setActivePath(remaining[0]?.path ?? null);
    setSelectedNode(null);
    await refreshWorkspaceTree();
    setStatus(`已将 ${node.name} 移到回收站`);
  }, [activePath, documents, refreshWorkspaceTree, secondaryPath, selectedNode, workspace]);

  const deleteTreeSelection = useCallback(async () => {
    if (!workspace || selectedPaths.size === 0) return;
    const paths = [...selectedPaths].filter((candidate) => ![...selectedPaths].some((parent) => (
      parent !== candidate && (candidate.startsWith(`${parent}/`) || candidate.startsWith(`${parent}\\`))
    )));
    const affected = documents.filter((document) => paths.some((target) => (
      document.path === target || document.path.startsWith(`${target}/`) || document.path.startsWith(`${target}\\`)
    )));
    if (affected.some((document) => document.content !== document.savedContent)) {
      setStatus('所选项目中包含未保存文件，请先保存或关闭');
      return;
    }
    if (!window.confirm(`确定将所选 ${paths.length} 个项目移到系统回收站吗？`)) return;
    for (const target of paths) {
      const result = await window.electronAPI.workspace.trashEntry(workspace.path, target);
      if (!result.success) {
        setStatus(`删除失败：${target} — ${displayError(result.error)}`);
        return;
      }
    }
    const affectedPaths = new Set(affected.map((document) => document.path));
    const remaining = documents.filter((document) => !affectedPaths.has(document.path));
    setDocuments(remaining);
    if (activePath && affectedPaths.has(activePath)) setActivePath(remaining[0]?.path ?? null);
    if (secondaryPath && affectedPaths.has(secondaryPath)) setSecondaryPath(null);
    setSelectedNode(null);
    setSelectedPaths(new Set());
    await refreshWorkspaceTree();
    setStatus(`已将 ${paths.length} 个项目移到回收站`);
  }, [activePath, documents, refreshWorkspaceTree, secondaryPath, selectedPaths, workspace]);

  const pasteTreeEntry = useCallback(async (target = selectedNode) => {
    if (!workspace || !treeClipboard) return;
    const parent = target?.type === 'directory'
      ? target.path
      : target?.path.replace(/[\\/][^\\/]+$/, '') ?? '';
    const nextPath = parent ? `${parent}/${treeClipboard.node.name}` : treeClipboard.node.name;
    if (
      nextPath === treeClipboard.node.path
      || nextPath.startsWith(`${treeClipboard.node.path}/`)
      || nextPath.startsWith(`${treeClipboard.node.path}\\`)
    ) {
      setStatus('不能将文件夹粘贴到自身内部');
      return;
    }
    const result = treeClipboard.cut
      ? await window.electronAPI.workspace.renameEntry(
        workspace.path, treeClipboard.node.path, nextPath,
      )
      : await window.electronAPI.workspace.copyEntry(
        workspace.path, treeClipboard.node.path, nextPath,
      );
    if (!result.success) {
      setStatus(`粘贴失败：${displayError(result.error)}`);
      return;
    }
    if (treeClipboard.cut) {
      remapOpenPaths(treeClipboard.node.path, nextPath);
      setTreeClipboard(null);
    }
    await refreshWorkspaceTree();
    setStatus(`已${treeClipboard.cut ? '移动' : '复制'}到 ${nextPath}`);
  }, [refreshWorkspaceTree, remapOpenPaths, selectedNode, treeClipboard, workspace]);

  const moveTreeEntry = useCallback(async (source: TreeNode, target: TreeNode) => {
    if (!workspace || target.type !== 'directory') return;
    const sourceName = source.path.split(/[\\/]/).pop() ?? source.name;
    const nextPath = `${target.path}/${sourceName}`;
    if (source.path === target.path || nextPath.startsWith(`${source.path}/`) || nextPath.startsWith(`${source.path}\\`)) {
      setStatus('不能将文件夹移动到自身内部');
      return;
    }
    const result = await window.electronAPI.workspace.renameEntry(workspace.path, source.path, nextPath);
    if (!result.success) {
      setStatus(`移动失败：${displayError(result.error)}`);
      return;
    }
    remapOpenPaths(source.path, nextPath);
    await refreshWorkspaceTree();
    setStatus(`已移动到 ${target.path}`);
  }, [refreshWorkspaceTree, remapOpenPaths, workspace]);

  const showQuickOpen = useCallback(async () => {
    if (!workspace) {
      setStatus('请先打开工作区');
      return;
    }
    setStatus('正在索引工作区文件…');
    const result = await window.electronAPI.workspace.listFiles(workspace.path);
    if (!result.success) {
      setStatus(`文件索引失败：${displayError(result.error)}`);
      return;
    }
    setQuickOpen({ open: true, query: '', files: (result.data ?? []) as TreeNode[] });
    setStatus(`已索引 ${result.data?.length ?? 0} 个文件`);
  }, [workspace]);

  const openStandaloneFile = useCallback(async () => {
    const result = await window.electronAPI.pickFile({ multiple: false });
    const file = (Array.isArray(result) ? result[0] : result) as FilePickResult | null;
    if (!file) return;
    try {
      const content = decodeBase64Utf8(file.content);
      const existing = documents.some((document) => document.path === file.path);
      if (!existing) {
        setDocuments((previous) => [...previous, {
          path: file.path,
          name: file.name,
          content,
          savedContent: content,
          language: languageIdFromName(file.name),
          standalone: true,
          encoding: 'utf8',
          lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
          mixedLineEndings: false,
          readOnly: false,
          pinned: true,
        }]);
      }
      setActivePath(file.path);
      setStatus(`已打开 ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '文件打开失败');
    }
  }, [documents]);

  const openTreeFile = useCallback(async (node: TreeNode, pinned = false) => {
    if (!workspace) return;
    if (documents.some((document) => document.path === node.path)) {
      if (pinned) {
        setDocuments((previous) => previous.map((document) => (
          document.path === node.path ? { ...document, pinned: true } : document
        )));
      }
      setActivePath(node.path);
      void revealWorkspacePath(node.path);
      return;
    }
    const requestId = ++openRequestRef.current;
    setStatus(`正在打开 ${node.name}…`);
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, node.path);
    if (requestId !== openRequestRef.current) return;
    if (!result.success || !result.data) {
      setStatus(displayError(result.error));
      return;
    }
    setDocuments((previous) => [
      ...previous.filter((document) => (
        document.pinned !== false || document.content !== document.savedContent
      )),
      {
        path: node.path,
        name: node.name,
        content: result.data!.content,
        savedContent: result.data!.content,
        language: languageIdFromName(node.name),
        encoding: result.data.encoding,
      lineEnding: result.data.lineEnding,
      mixedLineEndings: result.data.mixedLineEndings,
        modifiedAt: result.data.modifiedAt,
        readOnly: result.data.readOnly,
        pinned,
      },
    ]);
    setActivePath(node.path);
    void revealWorkspacePath(node.path);
    setStatus(`已打开 ${node.name}`);
  }, [documents, revealWorkspacePath, workspace]);

  const toggleDirectory = useCallback(async (node: TreeNode) => {
    if (!workspace) return;
    if (node.children !== undefined) {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        next.delete(node.path);
        return next;
      });
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, children: undefined,
      })));
      return;
    }
    setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
      ...current, loading: true,
    })));
    try {
      const children = await loadDirectory(workspace.path, node.path);
      setExpandedPaths((previous) => new Set(previous).add(node.path));
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, loading: false, children,
      })));
    } catch (error) {
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, loading: false,
      })));
      setStatus(error instanceof Error ? error.message : '目录读取失败');
    }
  }, [loadDirectory, workspace]);

  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const index = selectedNode ? visibleTreeNodes.findIndex((node) => node.path === selectedNode.path) : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown' ? Math.min(visibleTreeNodes.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
      const next = visibleTreeNodes[nextIndex];
      if (next) selectTreeNode(next);
    } else if (event.key === 'ArrowRight' && selectedNode?.type === 'directory' && selectedNode.children === undefined) {
      event.preventDefault(); void toggleDirectory(selectedNode);
    } else if (event.key === 'ArrowLeft' && selectedNode) {
      event.preventDefault();
      if (selectedNode.type === 'directory' && selectedNode.children !== undefined) void toggleDirectory(selectedNode);
      else {
        const parentPath = selectedNode.path.replace(/[\\/][^\\/]+$/, '');
        const parent = visibleTreeNodes.find((node) => node.path === parentPath);
        if (parent) selectTreeNode(parent);
      }
    } else if (event.key === 'Enter' && selectedNode) {
      event.preventDefault();
      if (selectedNode.type === 'directory') void toggleDirectory(selectedNode); else void openTreeFile(selectedNode);
    } else if (event.key === 'F2' && selectedNode) {
      event.preventDefault(); beginRename(selectedNode);
    } else if (event.key === 'Delete') {
      event.preventDefault(); void deleteTreeSelection();
    }
  }, [beginRename, deleteTreeSelection, openTreeFile, selectTreeNode, selectedNode, toggleDirectory, visibleTreeNodes]);

  const saveDocument = useCallback(async (document: OpenDocument, force = false) => {
    if (document.readOnly) {
      setStatus(`${document.name} 为只读文件`);
      return false;
    }
    setStatus(`正在保存 ${document.name}…`);
    if (!document.standalone) recentlySavedRef.current.set(document.path, Date.now());
    const result = document.standalone
      ? await window.electronAPI.writeTextFile(document.path, document.content)
      : workspace
        ? await window.electronAPI.workspace.writeTextFile(
          workspace.path,
          document.path,
          document.content,
          {
            encoding: document.encoding,
            lineEnding: document.lineEnding,
            expectedModifiedAt: document.modifiedAt,
            force,
          },
        )
        : { success: false, error: 'NO_WORKSPACE' };
    if (!result.success) {
      if (result.error === 'FILE_MODIFIED_EXTERNALLY') {
        setDocuments((previous) => previous.map((item) => (
          item.path === document.path ? { ...item, externalChanged: true } : item
        )));
      }
      setStatus(`保存失败：${displayError(result.error)}`);
      return false;
    }
    setDocuments((previous) => previous.map((item) => (
      item.path === document.path
        ? {
          ...item,
          content: document.content,
          savedContent: document.content,
          modifiedAt: 'data' in result ? result.data?.modifiedAt : item.modifiedAt,
          externalChanged: false,
        }
        : item
    )));
    setStatus(`已保存 ${document.name}`);
    return true;
  }, [workspace]);

  const formatActiveDocument = useCallback(async () => {
    const action = editorRef.current?.getAction('editor.action.formatDocument');
    if (!action?.isSupported()) {
      setStatus('当前语言没有可用的格式化程序');
      return false;
    }
    await action.run();
    appendOutput(`已格式化 ${activeDocument?.name ?? '当前文档'}`);
    return true;
  }, [activeDocument?.name, appendOutput]);

  const runEditorAction = useCallback(async (actionId: string, unavailableMessage: string) => {
    const action = editorRef.current?.getAction(actionId);
    if (!action?.isSupported()) {
      setStatus(unavailableMessage);
      return;
    }
    await action.run();
  }, []);

  const saveActive = useCallback(async () => {
    if (!activeDocument) return;
    if (preferences.formatOnSave && activeDocument.path === activePath) await formatActiveDocument();
    const latest = documentsRef.current.find((item) => item.path === activeDocument.path) ?? activeDocument;
    await saveDocument({ ...latest, content: editorRef.current?.getValue() ?? latest.content });
  }, [activeDocument, activePath, formatActiveDocument, preferences.formatOnSave, saveDocument]);

  const saveAll = useCallback(async () => {
    for (const document of documents.filter((item) => item.content !== item.savedContent)) {
      if (!await saveDocument(document)) break;
    }
  }, [documents, saveDocument]);

  const closeDocument = useCallback((path: string) => {
    const document = documents.find((item) => item.path === path);
    if (!document) return;
    if (document.content !== document.savedContent && !window.confirm(`“${document.name}”尚未保存，仍要关闭吗？`)) return;
    const index = documents.findIndex((item) => item.path === path);
    const remaining = documents.filter((item) => item.path !== path);
    setDocuments(remaining);
    if (secondaryPath === path) setSecondaryPath(null);
    if (activePath === path) {
      setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
    }
  }, [activePath, documents, secondaryPath]);

  const closeDocumentSet = useCallback((paths: string[]) => {
    const pathSet = new Set(paths);
    const dirty = documents.filter((document) => (
      pathSet.has(document.path) && document.content !== document.savedContent
    ));
    if (dirty.length > 0 && !window.confirm(`${dirty.length} 个文件尚未保存，仍要关闭吗？`)) return;
    const remaining = documents.filter((document) => !pathSet.has(document.path));
    setDocuments(remaining);
    if (secondaryPath && pathSet.has(secondaryPath)) setSecondaryPath(null);
    if (activePath && pathSet.has(activePath)) setActivePath(remaining[0]?.path ?? null);
  }, [activePath, documents, secondaryPath]);

  const moveTab = useCallback((sourcePath: string, targetPath: string) => {
    if (sourcePath === targetPath) return;
    setDocuments((previous) => {
      const sourceIndex = previous.findIndex((document) => document.path === sourcePath);
      const targetIndex = previous.findIndex((document) => document.path === targetPath);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const next = [...previous];
      const [source] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, source);
      return next;
    });
  }, []);

  const refreshProblems = useCallback(() => {
    setProblems(monaco.editor.getModels().flatMap((model) => (
      monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
        path: model.uri.path.replace(/^\//, ''),
        message: marker.message,
        line: marker.startLineNumber,
        column: marker.startColumn,
        severity: marker.severity,
      }))
    )));
  }, []);

  const refreshSymbols = useCallback(async (editor: monaco.editor.IStandaloneCodeEditor | null = editorRef.current) => {
    const model = editor?.getModel();
    if (!model) {
      setSymbols([]);
      return;
    }
    if (model.getLanguageId() === 'typescript' || model.getLanguageId() === 'javascript') {
      try {
        const getWorker = model.getLanguageId() === 'typescript'
          ? await monaco.languages.typescript.getTypeScriptWorker()
          : await monaco.languages.typescript.getJavaScriptWorker();
        const worker = await getWorker(model.uri);
        const tree = await worker.getNavigationTree(model.uri.toString());
        if (tree) {
          const semanticEntries: EditorSymbol[] = [];
          const visit = (item: { text?: string; kind?: string; spans?: Array<{ start: number }>; childItems?: unknown[] }, depth: number) => {
            const span = item.spans?.[0];
            if (depth > 0 && item.text && span) {
              const position = model.getPositionAt(span.start);
              semanticEntries.push({ name: item.text, detail: item.kind, line: position.lineNumber, column: position.column, depth: depth - 1 });
            }
            for (const child of item.childItems ?? []) visit(child as typeof item, depth + 1);
          };
          visit(tree, 0);
          setSymbols(semanticEntries);
          return;
        }
      } catch {
        // Fall through to a language-neutral outline.
      }
    }
    // Language-neutral fallback for common declarations.
    const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|interface|type|enum|function|const|let|var|def|fn|struct)\s+([\w$]+)/;
    const entries: EditorSymbol[] = [];
    for (let line = 1; line <= model.getLineCount(); line += 1) {
      const text = model.getLineContent(line);
      const match = declaration.exec(text);
      if (!match) continue;
      entries.push({ name: match[2], detail: match[1], line, column: Math.max(1, text.indexOf(match[2]) + 1), depth: 0 });
    }
    setSymbols(entries);
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column });
    });
    refreshProblems();
    void refreshSymbols(editor);
    editor.focus();
  }, [refreshProblems, refreshSymbols]);

  const runSearch = useCallback(async () => {
    if (!workspace || !searchPanel.query.trim()) return;
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    const result = await window.electronAPI.workspace.search(
      workspace.path,
      searchPanel.query.trim(),
      {
        caseSensitive: searchPanel.caseSensitive,
        wholeWord: searchPanel.wholeWord,
        useRegex: searchPanel.useRegex,
        include: searchPanel.include,
        exclude: searchPanel.exclude,
      },
    );
    if (!result.success) {
      setStatus(`搜索失败：${displayError(result.error)}`);
      setSearchPanel((previous) => ({ ...previous, loading: false }));
      return;
    }
    setSearchPanel((previous) => ({
      ...previous,
      loading: false,
      results: result.data ?? [],
    }));
    setStatus(`找到 ${result.data?.length ?? 0} 个结果`);
  }, [searchPanel.caseSensitive, searchPanel.exclude, searchPanel.include, searchPanel.query, searchPanel.useRegex, searchPanel.wholeWord, workspace]);

  const replaceAllSearchResults = useCallback(async () => {
    if (!workspace || searchPanel.results.length === 0) return;
    const paths = [...new Set(searchPanel.results.map((result) => result.path))];
    if (!window.confirm(`将在 ${paths.length} 个文件中替换 ${searchPanel.results.length} 处匹配，是否继续？`)) return;
    let matcher: RegExp;
    try {
      const escaped = searchPanel.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = searchPanel.useRegex ? searchPanel.query : escaped;
      matcher = new RegExp(searchPanel.wholeWord ? `\\b(?:${source})\\b` : source, searchPanel.caseSensitive ? 'g' : 'gi');
    } catch (error) {
      setStatus(`替换失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    let replacedFiles = 0;
    for (const filePath of paths) {
      const read = await window.electronAPI.workspace.readTextFile(workspace.path, filePath);
      if (!read.success || !read.data) continue;
      const content = read.data.content.replace(matcher, searchPanel.replacement);
      if (content === read.data.content) continue;
      const write = await window.electronAPI.workspace.writeTextFile(workspace.path, filePath, content, {
        encoding: read.data.encoding,
        lineEnding: read.data.lineEnding,
        expectedModifiedAt: read.data.modifiedAt,
      });
      if (!write.success) {
        setStatus(`替换中止：${filePath} — ${displayError(write.error)}`);
        break;
      }
      replacedFiles += 1;
      recentlySavedRef.current.set(filePath, Date.now());
      setDocuments((previous) => previous.map((document) => document.path === filePath ? {
        ...document, content, savedContent: content, modifiedAt: write.data?.modifiedAt,
      } : document));
    }
    appendOutput(`工作区替换完成：${replacedFiles}/${paths.length} 个文件`);
    setSearchPanel((previous) => ({ ...previous, loading: false, results: [] }));
    setStatus(`已在 ${replacedFiles} 个文件中完成替换`);
  }, [appendOutput, searchPanel.caseSensitive, searchPanel.query, searchPanel.replacement, searchPanel.results, searchPanel.useRegex, searchPanel.wholeWord, workspace]);

  const replaceSearchResults = useCallback(async (results: WorkspaceSearchResult[]) => {
    if (!workspace || results.length === 0) return;
    if (results.length > 1 && !window.confirm(`将替换 ${results.length} 处匹配，是否继续？`)) return;
    let matcher: RegExp;
    try {
      const escaped = searchPanel.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = searchPanel.useRegex ? searchPanel.query : escaped;
      matcher = new RegExp(`^(?:${searchPanel.wholeWord ? `\\b(?:${source})\\b` : source})`, searchPanel.caseSensitive ? '' : 'i');
    } catch (error) {
      setStatus(`替换失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const grouped = new Map<string, WorkspaceSearchResult[]>();
    for (const result of results) grouped.set(result.path, [...(grouped.get(result.path) ?? []), result]);
    const snapshots: ReplaceSnapshot[] = [];
    for (const [filePath, matches] of grouped) {
      const read = await window.electronAPI.workspace.readTextFile(workspace.path, filePath);
      if (!read.success || !read.data) continue;
      let content = read.data.content;
      snapshots.push({ path: filePath, content, encoding: read.data.encoding, lineEnding: read.data.lineEnding });
      const lines = content.split('\n');
      const offsets: number[] = [];
      let offset = 0;
      for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
      for (const match of [...matches].sort((a, b) => b.line - a.line || b.column - a.column)) {
        const start = (offsets[match.line - 1] ?? 0) + match.column - 1;
        const tail = content.slice(start);
        if (!matcher.test(tail)) continue;
        matcher.lastIndex = 0;
        content = `${content.slice(0, start)}${tail.replace(matcher, searchPanel.replacement)}`;
      }
      const write = await window.electronAPI.workspace.writeTextFile(workspace.path, filePath, content, { encoding: read.data.encoding, lineEnding: read.data.lineEnding, expectedModifiedAt: read.data.modifiedAt });
      if (!write.success) { setStatus(`替换失败：${filePath} — ${displayError(write.error)}`); return; }
      recentlySavedRef.current.set(filePath, Date.now());
      setDocuments((previous) => previous.map((document) => document.path === filePath ? { ...document, content, savedContent: content, modifiedAt: write.data?.modifiedAt } : document));
    }
    if (snapshots.length > 0) setReplaceHistory((previous) => [...previous.slice(-19), snapshots]);
    await runSearch();
  }, [runSearch, searchPanel.caseSensitive, searchPanel.query, searchPanel.replacement, searchPanel.useRegex, searchPanel.wholeWord, workspace]);

  const undoSearchReplace = useCallback(async () => {
    if (!workspace) return;
    const snapshots = replaceHistory.at(-1);
    if (!snapshots) return;
    for (const snapshot of snapshots) {
      const current = await window.electronAPI.workspace.readTextFile(workspace.path, snapshot.path);
      if (!current.success || !current.data) continue;
      const write = await window.electronAPI.workspace.writeTextFile(workspace.path, snapshot.path, snapshot.content, { encoding: snapshot.encoding, lineEnding: snapshot.lineEnding, expectedModifiedAt: current.data.modifiedAt });
      if (!write.success) { setStatus(`撤销替换失败：${snapshot.path} — ${displayError(write.error)}`); return; }
      recentlySavedRef.current.set(snapshot.path, Date.now());
      setDocuments((previous) => previous.map((document) => document.path === snapshot.path ? { ...document, content: snapshot.content, savedContent: snapshot.content, modifiedAt: write.data?.modifiedAt } : document));
    }
    setReplaceHistory((previous) => previous.slice(0, -1));
    await runSearch();
    setStatus('已撤销上一次搜索替换');
  }, [replaceHistory, runSearch, workspace]);

  const openSearchResult = useCallback(async (result: WorkspaceSearchResult) => {
    pendingRevealRef.current = { path: result.path, line: result.line, column: result.column };
    await openTreeFile({
      name: result.path.split(/[\\/]/).pop() ?? result.path,
      path: result.path,
      type: 'file',
    });
    setSearchPanel((previous) => ({ ...previous, open: false }));
  }, [openTreeFile]);

  const reloadExternalDocument = useCallback(async (document: OpenDocument) => {
    if (!workspace || document.standalone) return;
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, document.path);
    if (!result.success || !result.data) {
      setStatus(`重新加载失败：${displayError(result.error)}`);
      return;
    }
    setDocuments((previous) => previous.map((item) => item.path === document.path
      ? {
        ...item,
        content: result.data!.content,
        savedContent: result.data!.content,
        encoding: result.data!.encoding,
        lineEnding: result.data!.lineEnding,
        mixedLineEndings: result.data!.mixedLineEndings,
        modifiedAt: result.data!.modifiedAt,
        externalChanged: false,
        readOnly: result.data!.readOnly,
      }
      : item));
    setStatus(`已重新加载 ${document.name}`);
  }, [workspace]);

  const compareExternalDocument = useCallback(async (document: OpenDocument) => {
    if (!workspace || document.standalone) return;
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, document.path);
    if (!result.success || !result.data) {
      setStatus(`比较失败：${displayError(result.error)}`);
      return;
    }
    setDiffView({
      path: document.path,
      name: document.name,
      original: result.data.content,
      modified: document.content,
      language: document.language,
      source: 'external',
    });
  }, [workspace]);

  useEffect(() => {
    const restoreSession = async () => {
      const raw = localStorage.getItem('code-editor.session.v1');
      if (!raw) {
        restoringRef.current = false;
        return;
      }
      try {
        const session = JSON.parse(raw) as {
          workspace?: { path: string; name: string };
          openPaths?: string[];
          activePath?: string | null;
          sidebarVisible?: boolean;
          drafts?: Record<string, { content: string; pinned?: boolean }>;
          pinned?: Record<string, boolean>;
          viewStates?: Record<string, monaco.editor.ICodeEditorViewState | null>;
          expandedPaths?: string[];
          autoSave?: boolean;
        };
        if (!session.workspace) return;
        const restoredExpandedPaths = new Set(session.expandedPaths ?? []);
        const entries = await hydrateExpandedTree(
          session.workspace.path,
          await loadDirectory(session.workspace.path),
          restoredExpandedPaths,
        );
        const restoredDocuments: OpenDocument[] = [];
        for (const filePath of session.openPaths?.slice(0, 20) ?? []) {
          const result = await window.electronAPI.workspace.readTextFile(
            session.workspace.path, filePath,
          );
          if (!result.success || !result.data) continue;
          restoredDocuments.push({
            path: filePath,
            name: filePath.split(/[\\/]/).pop() ?? filePath,
            content: session.drafts?.[filePath]?.content ?? result.data.content,
            savedContent: result.data.content,
            language: languageIdFromName(filePath),
            encoding: result.data.encoding,
            lineEnding: result.data.lineEnding,
            mixedLineEndings: result.data.mixedLineEndings,
            modifiedAt: result.data.modifiedAt,
            readOnly: result.data.readOnly,
            pinned: session.drafts?.[filePath]?.pinned ?? session.pinned?.[filePath] ?? true,
          });
        }
        setWorkspace(session.workspace);
        setTree(entries);
        setExpandedPaths(restoredExpandedPaths);
        setDocuments(restoredDocuments);
        setActivePath(
          restoredDocuments.some((document) => document.path === session.activePath)
            ? session.activePath ?? null
            : restoredDocuments[0]?.path ?? null,
        );
        setSidebarVisible(session.sidebarVisible ?? true);
        setAutoSave(session.autoSave ?? false);
        viewStatesRef.current = session.viewStates ?? {};
        setStatus(`已恢复 ${session.workspace.name}`);
      } catch {
        localStorage.removeItem('code-editor.session.v1');
      } finally {
        restoringRef.current = false;
      }
    };
    void restoreSession();
  }, [hydrateExpandedTree, loadDirectory]);

  useEffect(() => {
    if (restoringRef.current) return;
    if (!workspace) {
      localStorage.removeItem('code-editor.session.v1');
      return;
    }
    const timer = window.setTimeout(() => {
      let draftBytes = 0;
      const drafts: Record<string, { content: string; pinned?: boolean }> = {};
      for (const document of documents) {
        if (
          document.standalone
          || document.content === document.savedContent
          || document.content.length > 1024 * 1024
          || draftBytes + document.content.length > 2 * 1024 * 1024
        ) continue;
        drafts[document.path] = { content: document.content, pinned: document.pinned };
        draftBytes += document.content.length;
      }
      localStorage.setItem('code-editor.session.v1', JSON.stringify({
        workspace,
        openPaths: documents.filter((document) => !document.standalone).map((document) => document.path),
        activePath: activeDocument?.standalone ? null : activePath,
        sidebarVisible,
        drafts,
        pinned: Object.fromEntries(documents.map((document) => [document.path, document.pinned !== false])),
        viewStates: viewStatesRef.current,
        expandedPaths: [...expandedPaths],
        autoSave,
      }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeDocument?.standalone, activePath, autoSave, documents, expandedPaths, sidebarVisible, workspace]);

  useEffect(() => {
    if (!autoSave) return;
    const dirtyDocuments = documents.filter((document) => (
      document.content !== document.savedContent && !document.readOnly && !document.externalChanged
    ));
    if (dirtyDocuments.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const document of dirtyDocuments) void saveDocument(document);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoSave, documents, saveDocument]);

  useEffect(() => {
    localStorage.setItem('code-editor.preferences.v1', JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => localStorage.setItem('code-editor.sidebar-width', String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem('code-editor.terminal-profile', terminalProfileName);
    localStorage.setItem('code-editor.terminal-env', terminalEnvText);
    localStorage.setItem('code-editor.terminal-tabs', JSON.stringify(terminalTabs.map(({ title, cwd, profile }) => ({ title, cwd, profile }))));
  }, [terminalEnvText, terminalProfileName, terminalTabs]);
  useEffect(() => {
    localStorage.setItem('code-editor.terminal-profile', terminalProfileName);
    localStorage.setItem('code-editor.terminal-env', terminalEnvText);
    localStorage.setItem('code-editor.terminal-tabs', JSON.stringify(terminalTabs.map(({ title, cwd, profile }) => ({ title, cwd, profile }))));
  }, [terminalEnvText, terminalProfileName, terminalTabs]);

  useEffect(() => {
    const disposable = monaco.editor.onDidChangeMarkers(() => refreshProblems());
    refreshProblems();
    return () => disposable.dispose();
  }, [refreshProblems]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshSymbols(); }, 250);
    return () => window.clearTimeout(timer);
  }, [activePath, activeDocument?.content, refreshSymbols]);

  useEffect(() => {
    if (!workspace || !bottomPanel.open || bottomPanel.tab !== 'sourceControl') return;
    void Promise.all([refreshGitStatus(), refreshGitOverview()]);
  }, [bottomPanel.open, bottomPanel.tab, refreshGitOverview, refreshGitStatus, workspace]);

  useEffect(() => window.electronAPI.workspace.onGitProgress((event) => {
    if (event.state === 'started') setGitBusy(event.operation);
    else setGitBusy(null);
    setStatus(event.message);
  }), []);

  const showGitDiff = useCallback(async (entry: WorkspaceGitStatus) => {
    if (!workspace) return;
    if (entry.status.includes('U')) {
      const versions = await window.electronAPI.workspace.gitOperation<{ base: string; ours: string; theirs: string }>(workspace.path, 'conflictVersions', { path: entry.path });
      if (!versions.success || !versions.data) {
        setStatus(`冲突版本读取失败：${displayError(versions.error)}`);
        return;
      }
      setGitHunks([]);
      setDiffView({ path: entry.path, name: entry.path, original: versions.data.ours, modified: versions.data.theirs, language: languageIdFromName(entry.path), source: 'merge' });
      return;
    }
    const current = await window.electronAPI.workspace.readTextFile(workspace.path, entry.path);
    if (!current.success || !current.data) {
      setStatus(`Diff 读取失败：${displayError(current.error)}`);
      return;
    }
    const [head, patch] = await Promise.all([
      window.electronAPI.workspace.gitShowHead(workspace.path, entry.path),
      window.electronAPI.workspace.gitOperation<string>(workspace.path, 'fileDiff', { path: entry.path }),
    ]);
    setGitHunks(patch.success ? extractGitHunks(patch.data ?? '') : []);
    setDiffView({
      path: entry.path,
      name: entry.path,
      original: head.success ? head.data ?? '' : '',
      modified: current.data.content,
      language: languageIdFromName(entry.path),
      source: 'git',
    });
  }, [workspace]);

  const showFileTimeline = useCallback(async (node: TreeNode) => {
    if (!workspace || node.type !== 'file') return;
    const result = await window.electronAPI.workspace.gitOperation<WorkspaceGitCommit[]>(workspace.path, 'log', { limit: 100, path: node.path });
    if (!result.success) {
      setStatus(`文件时间线读取失败：${displayError(result.error)}`);
      return;
    }
    setGitHistory(result.data ?? []);
    setGitView('history');
    setBottomPanel((previous) => ({ ...previous, open: true, tab: 'sourceControl' }));
    setTreeMenu(null);
  }, [workspace]);

  const stageGitHunk = useCallback(async (hunk: GitHunk) => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, 'stagePatch', { patch: hunk.patch });
    if (!result.success) {
      setStatus(`Hunk 暂存失败：${displayError(result.error)}`);
      return;
    }
    setGitHunks((previous) => previous.filter((item) => item.patch !== hunk.patch));
    await refreshGitStatus();
    setStatus(`已暂存 ${hunk.label}`);
  }, [refreshGitStatus, workspace]);

  const resolveGitConflict = useCallback(async (strategy: 'ours' | 'theirs') => {
    if (!workspace || !diffView || diffView.source !== 'merge') return;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, 'resolveConflict', { path: diffView.path, strategy });
    if (!result.success) {
      setStatus(`冲突解决失败：${displayError(result.error)}`);
      return;
    }
    setDiffView(null);
    await refreshGitStatus();
    setStatus(`已使用${strategy === 'ours' ? '当前分支' : '传入分支'}版本并暂存`);
  }, [diffView, refreshGitStatus, workspace]);

  const generateAiEdit = useCallback(async () => {
    if (!activeDocument || !aiInstruction.trim()) return;
    if (!aiApi.apiKey) {
      setStatus('请先在设置中配置 AI API');
      return;
    }
    setAiEditing(true);
    setStatus(`AI 正在修改 ${activeDocument.name}…`);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      if (aiMultiFile && workspace) {
        const listed = await window.electronAPI.workspace.listFiles(workspace.path);
        const terms = aiInstruction.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2);
        const candidates = (listed.data ?? []).filter((file) => /\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|go|rs|java|vue|svelte)$/i.test(file.name)).sort((a, b) => {
          const score = (path: string) => terms.reduce((total, term) => total + (path.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
          return score(b.path) - score(a.path);
        });
        const contextPaths = [...new Set([activeDocument.path, ...documents.filter((item) => !item.standalone).map((item) => item.path), ...candidates.slice(0, 8).map((item) => item.path)])].slice(0, 10);
        const contexts: AiFileProposal[] = [];
        for (const filePath of contextPaths) {
          const opened = documents.find((item) => item.path === filePath);
          if (opened) contexts.push({ path: filePath, original: opened.content, modified: opened.content, language: opened.language, metadata: opened });
          else {
            const read = await window.electronAPI.workspace.readTextFile(workspace.path, filePath);
            if (read.success && read.data && read.data.content.length <= 200_000) contexts.push({
              path: filePath, original: read.data.content, modified: read.data.content, language: languageIdFromName(filePath),
              metadata: { path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, content: read.data.content, savedContent: read.data.content, language: languageIdFromName(filePath), encoding: read.data.encoding, lineEnding: read.data.lineEnding, mixedLineEndings: read.data.mixedLineEndings, modifiedAt: read.data.modifiedAt, readOnly: read.data.readOnly, pinned: true },
            });
          }
        }
        const messages = [
          { role: 'system' as const, content: '你是多文件代码修改助手。返回严格 JSON：{"files":[{"path":"相对路径","content":"修改后的完整文件"}]}。只返回需要修改的文件，不得返回 Markdown。不得修改未提供的路径。' },
          { role: 'user' as const, content: `修改要求：${aiInstruction.trim()}\n\n工作区候选文件：\n${contexts.map((item) => `--- ${item.path} ---\n${item.original}`).join('\n\n')}` },
        ];
        let response = '';
        for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.15, maxTokens: 24000 })) response += chunk.delta;
        const jsonText = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(jsonText) as { files?: Array<{ path: string; content: string }> };
        const allowed = new Map(contexts.map((item) => [item.path.replace(/\\/g, '/'), item]));
        const proposals = (parsed.files ?? []).flatMap((file) => {
          const context = allowed.get(file.path.replace(/\\/g, '/'));
          if (!context || typeof file.content !== 'string' || file.content === context.original) return [];
          return [{ ...context, modified: file.content }];
        });
        if (proposals.length === 0) {
          setStatus('AI 未生成有效的多文件修改');
          return;
        }
        setAiProposals(proposals);
        const first = proposals[0];
        setDiffView({ path: first.path, name: first.path, original: first.original, modified: first.modified, language: first.language, source: 'ai' });
        appendOutput(`AI 已生成 ${proposals.length} 个文件的修改候选`);
        return;
      }
      const selection = editorRef.current?.getSelection();
      const selectedText = selection && !selection.isEmpty() ? editorRef.current?.getModel()?.getValueInRange(selection) : '';
      const messages = [
        { role: 'system' as const, content: '你是代码编辑器中的修改助手。根据要求修改文件。只返回修改后的完整文件内容，不要解释，不要输出 diff。' },
        { role: 'user' as const, content: `文件名：${activeDocument.name}\n语言：${activeDocument.language}\n修改要求：${aiInstruction.trim()}${selectedText ? `\n重点关注的选中代码：\n${selectedText}` : ''}\n\n当前完整文件：\n${activeDocument.content}` },
      ];
      let response = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.2, maxTokens: 16000 })) response += chunk.delta;
      const fenced = response.match(/```(?:[\w+-]+)?\s*\n([\s\S]*?)```/);
      const modified = (fenced?.[1] ?? response).trimEnd();
      if (!modified || modified === activeDocument.content.trimEnd()) {
        setStatus('AI 未生成有效修改');
        return;
      }
      setDiffView({ path: activeDocument.path, name: activeDocument.name, original: activeDocument.content, modified, language: activeDocument.language, source: 'ai' });
      appendOutput(`AI 已生成 ${activeDocument.name} 的修改候选，等待确认`);
    } catch (error) {
      setStatus(`AI 修改失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAiEditing(false);
    }
  }, [activeDocument, aiApi.apiKey, aiApi.baseUrl, aiApi.model, aiInstruction, aiMultiFile, appendOutput, documents, workspace]);

  const acceptAiEdit = useCallback(() => {
    if (!diffView || diffView.source !== 'ai') return;
    const proposal = aiProposals.find((item) => item.path === diffView.path);
    setDocuments((previous) => {
      const exists = previous.some((document) => document.path === diffView.path);
      const updated = previous.map((document) => document.path === diffView.path ? { ...document, content: diffView.modified, pinned: true } : document);
      if (exists || !proposal?.metadata) return updated;
      return [...updated, { ...proposal.metadata, content: diffView.modified, pinned: true }];
    });
    setAiHistory((previous) => [...previous.slice(-49), { id: Date.now(), path: diffView.path, before: diffView.original, after: diffView.modified }]);
    setActivePath(diffView.path);
    appendOutput(`已接受 AI 对 ${diffView.name} 的修改（尚未保存）`);
    setStatus('已接受 AI 修改，请检查后保存');
    const remaining = aiProposals.filter((item) => item.path !== diffView.path);
    setAiProposals(remaining);
    const next = remaining[0];
    setDiffView(next ? { path: next.path, name: next.path, original: next.original, modified: next.modified, language: next.language, source: 'ai' } : null);
  }, [aiProposals, appendOutput, diffView]);

  const rejectAiEdit = useCallback(() => {
    if (!diffView || diffView.source !== 'ai') return;
    const remaining = aiProposals.filter((item) => item.path !== diffView.path);
    setAiProposals(remaining);
    const next = remaining[0];
    setDiffView(next ? { path: next.path, name: next.path, original: next.original, modified: next.modified, language: next.language, source: 'ai' } : null);
  }, [aiProposals, diffView]);

  const undoLastAiEdit = useCallback(() => {
    const edit = aiHistory.at(-1);
    if (!edit) return;
    setDocuments((previous) => previous.map((document) => document.path === edit.path ? { ...document, content: edit.before, pinned: true } : document));
    setAiHistory((previous) => previous.slice(0, -1));
    setActivePath(edit.path);
    setStatus(`已撤销 AI 对 ${edit.path} 的修改`);
  }, [aiHistory]);

  const updateGitStage = useCallback(async (entry: WorkspaceGitStatus, stage: boolean) => {
    if (!workspace) return;
    const result = stage
      ? await window.electronAPI.workspace.gitStage(workspace.path, [entry.path])
      : await window.electronAPI.workspace.gitUnstage(workspace.path, [entry.path]);
    if (!result.success) setStatus(`Git 操作失败：${displayError(result.error)}`);
    else await refreshGitStatus();
  }, [refreshGitStatus, workspace]);

  const commitGitChanges = useCallback(async () => {
    if (!workspace || !commitMessage.trim()) return;
    const result = await window.electronAPI.workspace.gitCommit(workspace.path, commitMessage);
    if (!result.success) {
      setStatus(`提交失败：${displayError(result.error)}`);
      return;
    }
    appendOutput(result.data ?? 'Git 提交成功');
    setCommitMessage('');
    setStatus('Git 提交成功');
    await refreshGitStatus();
  }, [appendOutput, commitMessage, refreshGitStatus, workspace]);

  useLayoutEffect(() => {
    if (!activePath || !editorRef.current) return;
    const pathForEffect = activePath;
    const restoreTimer = window.setTimeout(() => {
      const viewState = viewStatesRef.current[pathForEffect];
      if (viewState && editorRef.current) editorRef.current.restoreViewState(viewState);
    }, 0);
    return () => {
      window.clearTimeout(restoreTimer);
      if (editorRef.current) {
        viewStatesRef.current[pathForEffect] = editorRef.current.saveViewState();
      }
    };
  }, [activePath]);

  useEffect(() => {
    if (!workspace) return;
    let disposed = false;
    void window.electronAPI.workspace.watch(workspace.path)
      .then((result) => {
        if (!result.success && !disposed) setStatus(`文件监听不可用：${displayError(result.error)}`);
      })
      .catch((error) => {
        if (!disposed) setStatus(`文件监听不可用：${String(error)}`);
      });
    const unsubscribe = window.electronAPI.workspace.onFileChanged((event) => {
      if (disposed) return;
      if (event.type === 'rename') void refreshWorkspaceTree();
      const document = documentsRef.current.find((item) => item.path === event.path);
      if (!document || document.standalone) return;
      const savedAt = recentlySavedRef.current.get(event.path) ?? 0;
      if (Date.now() - savedAt < 1500) return;
      void window.electronAPI.workspace.readTextFile(workspace.path, event.path).then((result) => {
        if (!result.success || !result.data) {
          if (event.type === 'rename') {
            setDocuments((previous) => previous.map((item) => item.path === event.path
              ? { ...item, missing: true, readOnly: true }
              : item));
            setStatus(`${document.name} 已在外部删除或重命名`);
          }
          return;
        }
        const latest = documentsRef.current.find((item) => item.path === event.path);
        if (latest && latest.content !== latest.savedContent) {
          setDocuments((previous) => previous.map((item) => (
            item.path === event.path ? { ...item, externalChanged: true } : item
          )));
          setStatus(`${document.name} 已在外部修改，请选择重新加载或覆盖保存`);
          return;
        }
        setDocuments((previous) => previous.map((item) => item.path === event.path
          ? {
            ...item,
            content: result.data!.content,
            savedContent: result.data!.content,
            encoding: result.data!.encoding,
            lineEnding: result.data!.lineEnding,
            mixedLineEndings: result.data!.mixedLineEndings,
            modifiedAt: result.data!.modifiedAt,
            externalChanged: false,
            readOnly: result.data!.readOnly,
            missing: false,
          }
          : item));
        setStatus(`已自动刷新 ${document.name}`);
      });
    });
    return () => {
      disposed = true;
      unsubscribe();
      void window.electronAPI.workspace.unwatch().catch(() => undefined);
    };
  }, [refreshWorkspaceTree, workspace]);

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.path !== activePath || !editorRef.current) return;
    const position = { lineNumber: pending.line, column: pending.column };
    editorRef.current.setPosition(position);
    editorRef.current.revealPositionInCenter(position);
    editorRef.current.focus();
    pendingRevealRef.current = null;
  }, [activePath, activeDocument?.content]);

  useEffect(() => {
    if (!workspace || !activeDocument || activeDocument.standalone || !editorRef.current) {
      gitDecorationsRef.current?.clear();
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.electronAPI.workspace.gitOperation<string>(workspace.path, 'fileDiff', { path: activeDocument.path }).then((result) => {
        if (cancelled || !editorRef.current || !result.success) return;
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (const line of (result.data ?? '').split('\n')) {
          const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
          if (!match) continue;
          const oldCount = Number(match[1] ?? 1);
          const start = Number(match[2]);
          const newCount = Number(match[3] ?? 1);
          const kind = newCount === 0 ? 'deleted' : oldCount === 0 ? 'added' : 'modified';
          const count = Math.max(1, newCount);
          decorations.push({
            range: new monaco.Range(Math.max(1, start), 1, Math.max(1, start + count - 1), 1),
            options: { isWholeLine: true, className: `git-line-${kind}`, linesDecorationsClassName: `git-gutter-${kind}`, overviewRuler: { color: kind === 'added' ? '#22c55e' : kind === 'deleted' ? '#ef4444' : '#3b82f6', position: monaco.editor.OverviewRulerLane.Left } },
          });
        }
        gitDecorationsRef.current?.clear();
        gitDecorationsRef.current = editorRef.current.createDecorationsCollection(decorations);
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeDocument, workspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.altKey) void saveAll();
        else void saveActive();
      }
      if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openStandaloneFile();
      }
      if (command && event.key.toLowerCase() === 'w' && activePath) {
        event.preventDefault();
        closeDocument(activePath);
      }
      if (command && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
      }
      if (command && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void showQuickOpen();
      }
      if (command && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchPanel((previous) => ({ ...previous, open: true }));
      }
      if (command && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setBottomPanel({ open: true, tab: 'problems', height: 220 });
      }
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault();
        setBottomPanel((previous) => ({ ...previous, open: previous.tab !== 'terminal' || !previous.open, tab: 'terminal' }));
      }
      if (event.key === 'Escape') {
        setQuickOpen((previous) => ({ ...previous, open: false }));
        setSearchPanel((previous) => ({ ...previous, open: false }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePath, closeDocument, openStandaloneFile, saveActive, saveAll, showQuickOpen]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyDocuments) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDirtyDocuments]);

  const editorPath = useMemo(
    () => activeDocument ? `file:///${activeDocument.path.replace(/\\/g, '/')}` : undefined,
    [activeDocument],
  );
  const quickOpenResults = useMemo(() => {
    const query = quickOpen.query.trim().toLowerCase();
    if (!query) return quickOpen.files.slice(0, 100);
    return quickOpen.files
      .filter((file) => file.path.toLowerCase().includes(query))
      .sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().startsWith(query) ? 0 : 1;
        const bNameMatch = b.name.toLowerCase().startsWith(query) ? 0 : 1;
        return aNameMatch - bNameMatch || a.path.length - b.path.length;
      })
      .slice(0, 100);
  }, [quickOpen.files, quickOpen.query]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSidebarVisible((value) => !value)} title="切换资源管理器 (Ctrl+B)">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={openWorkspace}>
          <FolderOpen className="h-4 w-4" /> 打开文件夹
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={openStandaloneFile}>
          <FileText className="h-4 w-4" /> 打开文件
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setSearchPanel((previous) => ({ ...previous, open: true }))}
          disabled={!workspace}
        >
          <Search className="h-4 w-4" /> 全文搜索
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={() => void runEditorAction('editor.action.revealDefinition', '当前位置没有可跳转的定义')} title="转到定义 (F12)">定义</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={() => void runEditorAction('editor.action.referenceSearch.trigger', '当前位置没有可查找的引用')} title="查找所有引用 (Shift+F12)">引用</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={() => void formatActiveDocument()} title="格式化文档 (Shift+Alt+F)">
          格式化
        </Button>
        <Button size="sm" variant={bottomPanel.open ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setBottomPanel((previous) => ({ ...previous, open: !previous.open }))}>
          面板
        </Button>
        <Button size="sm" variant={autoSave ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setAutoSave((value) => !value)}>
          自动保存
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument || activeDocument.content === activeDocument.savedContent} onClick={saveActive}>
          保存
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!hasDirtyDocuments} onClick={saveAll}>
          全部保存
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <aside className="relative flex shrink-0 flex-col border-r bg-sidebar-bg outline-none" style={{ width: sidebarWidth }} tabIndex={0} onKeyDown={handleTreeKeyDown} aria-label="文件资源管理器">
            <div className="flex h-9 items-center gap-0.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="flex-1 px-1">Explorer</span>
              <button type="button" className="rounded p-1 hover:bg-accent" title="新建文件" onClick={() => beginCreate('file')} disabled={!workspace}>
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="新建文件夹" onClick={() => beginCreate('directory')} disabled={!workspace}>
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="重命名选中项" onClick={() => beginRename()} disabled={!selectedNode}>
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="删除选中项" onClick={() => void (selectedPaths.size > 1 ? deleteTreeSelection() : deleteSelected())} disabled={!selectedNode}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="快速打开 (Ctrl+P)" onClick={() => void showQuickOpen()} disabled={!workspace}>
                <Search className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="刷新资源管理器" onClick={() => void refreshWorkspaceTree()} disabled={!workspace}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="折叠全部" onClick={() => {
                setExpandedPaths(new Set());
                setTree((previous) => previous.map((node) => ({ ...node, children: undefined })));
              }} disabled={!workspace}>
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </button>
            </div>
            {workspace ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex h-7 items-center gap-1 px-2 text-xs font-semibold">
                  <ChevronDown className="h-3 w-3" />
                  <span className="truncate uppercase">{workspace.name}</span>
                </div>
                {treeEdit && treeEdit.mode !== 'rename' && (
                  <div className="flex h-7 items-center gap-1 px-2">
                    {treeEdit.mode === 'create-directory'
                      ? <FolderOpen className="h-3.5 w-3.5 text-primary" />
                      : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    <input
                      autoFocus
                      value={treeEdit.value}
                      onChange={(event) => setTreeEdit((previous) => previous ? { ...previous, value: event.target.value } : previous)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitTreeEdit();
                        if (event.key === 'Escape') setTreeEdit(null);
                      }}
                      onBlur={() => void commitTreeEdit()}
                      placeholder={selectedNode?.type === 'directory' ? `在 ${selectedNode.name} 中创建` : '输入名称'}
                      className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
                {tree.map((node) => (
                  <FileTreeRow
                    key={node.path}
                    node={node}
                    depth={0}
                    activePath={activePath}
                    selectedPaths={selectedPaths}
                    onOpen={openTreeFile}
                    onToggle={toggleDirectory}
                    onSelect={selectTreeNode}
                    editing={treeEdit}
                    onEditChange={(value) => setTreeEdit((previous) => previous ? { ...previous, value } : previous)}
                    onEditCommit={() => void commitTreeEdit()}
                    onEditCancel={() => setTreeEdit(null)}
                    onContextMenu={(event, current) => {
                      event.preventDefault();
                      if (!selectedPaths.has(current.path)) {
                        setSelectedPaths(new Set([current.path]));
                        setSelectedNode(current);
                      }
                      setTreeMenu({ x: event.clientX, y: event.clientY, node: current });
                    }}
                    onMove={(source, target) => void moveTreeEntry(source, target)}
                    decorations={treeDecorations}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-5 text-xs leading-5 text-muted-foreground">
                尚未打开文件夹。打开工作区后可浏览和编辑其中的文件。
              </div>
            )}
            <div className="absolute bottom-0 right-[-3px] top-0 z-20 w-1.5 cursor-col-resize" onMouseDown={(event) => {
              const startX = event.clientX;
              const startWidth = sidebarWidth;
              const move = (moveEvent: MouseEvent) => setSidebarWidth(Math.max(180, Math.min(520, startWidth + moveEvent.clientX - startX)));
              const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
              window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
            }} />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {documents.length > 0 && (
            <div className="flex h-9 shrink-0 overflow-x-auto border-b bg-muted/40">
              {documents.map((document) => {
                const dirty = document.content !== document.savedContent;
                const active = document.path === activePath;
                return (
                  <button
                    type="button"
                    key={document.path}
                    className={`group flex min-w-0 max-w-52 items-center gap-2 border-r px-3 text-xs ${
                      active ? 'border-t-2 border-t-primary bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                    }`}
                    onClick={() => setActivePath(document.path)}
                    onDoubleClick={() => setDocuments((previous) => previous.map((item) => (
                      item.path === document.path ? { ...item, pinned: true } : item
                    )))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTabMenu({ x: event.clientX, y: event.clientY, path: document.path });
                    }}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('application/x-nwd-tab-path', document.path)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveTab(event.dataTransfer.getData('application/x-nwd-tab-path'), document.path);
                    }}
                    title={document.path}
                  >
                    <Code className="h-3.5 w-3.5 shrink-0" />
                    <span className={`truncate ${document.pinned === false ? 'italic' : ''}`}>{document.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`shrink-0 rounded p-0.5 hover:bg-muted ${dirty ? '' : 'opacity-0 group-hover:opacity-100'}`}
                      onClick={(event) => { event.stopPropagation(); closeDocument(document.path); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') closeDocument(document.path);
                      }}
                      aria-label={`关闭 ${document.name}${dirty ? '，未保存' : ''}`}
                    >
                      {dirty
                        ? <span className="block h-2 w-2 rounded-full bg-foreground/70 group-hover:hidden" />
                        : null}
                      <X className={`h-3 w-3 ${dirty ? 'hidden group-hover:block' : ''}`} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {activeDocument?.externalChanged && (
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 text-xs">
              <span className="flex-1 truncate">该文件已在外部修改，本地编辑内容尚未保存。</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void reloadExternalDocument(activeDocument)}>
                重新加载
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void compareExternalDocument(activeDocument)}>
                比较
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void saveDocument(activeDocument, true)}>
                覆盖保存
              </Button>
            </div>
          )}

          {activeDocument?.missing && (
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 text-xs">
              <span className="flex-1 truncate">该文件已在外部删除或重命名，当前内容以只读方式保留。</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => closeDocument(activeDocument.path)}>
                关闭标签
              </Button>
            </div>
          )}

          {activeDocument && (
            <nav className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b px-3 text-[11px] text-muted-foreground" aria-label="Breadcrumb">
              {(workspace ? activeDocument.path.split(/[\\/]/) : [activeDocument.name]).map((part, index, parts) => (
                <React.Fragment key={`${part}:${index}`}>
                  {index > 0 && <span className="opacity-50">›</span>}
                  <span className={index === parts.length - 1 ? 'text-foreground' : ''}>{part}</span>
                </React.Fragment>
              ))}
            </nav>
          )}

          {activeDocument ? (
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                <Editor
                  path={editorPath}
                  language={activeDocument.language}
                  value={activeDocument.content}
                  theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                  onMount={handleMount}
                  onChange={(value) => {
                    setDocuments((previous) => previous.map((document) => (
                      document.path === activeDocument.path
                        ? { ...document, content: value ?? '', pinned: true }
                        : document
                    )));
                  }}
                  options={{
                    automaticLayout: true,
                    glyphMargin: true,
                    fontFamily: "'Cascadia Code', 'SF Mono', Consolas, monospace",
                    fontSize: preferences.fontSize,
                    lineHeight: Math.round(preferences.fontSize * 1.55),
                    minimap: { enabled: preferences.minimap },
                    padding: { top: 8 },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    tabSize: preferences.tabSize,
                    wordWrap: preferences.wordWrap,
                    readOnly: activeDocument.readOnly,
                  }}
                />
              </div>
              {secondaryDocument && (
                <div className="relative min-w-0 flex-1 border-l">
                  <div className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded bg-background/90 px-1 text-[10px] shadow">
                    <span className="max-w-36 truncate">{secondaryDocument.name}</span>
                    <button type="button" className="rounded p-1 hover:bg-accent" title="关闭分栏" onClick={() => setSecondaryPath(null)}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <Editor
                    path={`file:///${secondaryDocument.path.replace(/\\/g, '/')}`}
                    language={secondaryDocument.language}
                    value={secondaryDocument.content}
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                    onChange={(value) => {
                      setDocuments((previous) => previous.map((document) => (
                        document.path === secondaryDocument.path
                          ? { ...document, content: value ?? '', pinned: true }
                          : document
                      )));
                    }}
                    options={{
                      automaticLayout: true,
                      glyphMargin: true,
                      fontFamily: "'Cascadia Code', 'SF Mono', Consolas, monospace",
                      fontSize: preferences.fontSize,
                      lineHeight: Math.round(preferences.fontSize * 1.55),
                      minimap: { enabled: preferences.minimap },
                      padding: { top: 8 },
                      scrollBeyondLastLine: false,
                      tabSize: preferences.tabSize,
                      wordWrap: preferences.wordWrap,
                      readOnly: secondaryDocument.readOnly,
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <Code className="h-14 w-14 opacity-40" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">代码编辑器</p>
                <p className="mt-1 text-xs">打开文件夹开始浏览项目，或直接打开单个文本文件。</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={openWorkspace}>打开文件夹</Button>
                <Button variant="outline" size="sm" onClick={openStandaloneFile}>打开文件</Button>
              </div>
            </div>
          )}

          {bottomPanel.open && (
            <section className="relative flex shrink-0 flex-col border-t bg-background" style={{ height: bottomPanel.height }}>
              <div
                className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize"
                onMouseDown={(event) => {
                  const startY = event.clientY;
                  const startHeight = bottomPanel.height;
                  const move = (moveEvent: MouseEvent) => setBottomPanel((previous) => ({
                    ...previous, height: Math.max(120, Math.min(520, startHeight + startY - moveEvent.clientY)),
                  }));
                  const up = () => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                  };
                  window.addEventListener('mousemove', move);
                  window.addEventListener('mouseup', up);
                }}
              />
              <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-[11px]">
                {([
                  ['problems', `问题 (${problems.length})`],
                  ['output', '输出'],
                  ['terminal', '终端'],
                  ['outline', `大纲 (${symbols.length})`],
                  ['sourceControl', `源代码管理 (${gitStatus.length})`],
                  ['ai', 'AI 修改'],
                  ['settings', '设置'],
                ] as Array<[BottomPanelTab, string]>).map(([tab, label]) => (
                  <button key={tab} type="button" className={`h-full border-b-2 px-2 ${bottomPanel.tab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setBottomPanel((previous) => ({ ...previous, tab }))}>
                    {label}
                  </button>
                ))}
                <div className="flex-1" />
                <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => setBottomPanel((previous) => ({ ...previous, open: false }))} aria-label="关闭底部面板"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {bottomPanel.tab === 'terminal' && (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex h-8 shrink-0 items-center border-b bg-muted/30 px-1">
                      <div className="flex min-w-0 flex-1 overflow-x-auto">
                        {terminalTabs.map((tab) => (
                          <button key={tab.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData('application/x-terminal-tab', tab.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const sourceId = event.dataTransfer.getData('application/x-terminal-tab'); setTerminalTabs((previous) => { const source = previous.findIndex((item) => item.id === sourceId); const target = previous.findIndex((item) => item.id === tab.id); if (source < 0 || target < 0) return previous; const next = [...previous]; const [moved] = next.splice(source, 1); next.splice(target, 0, moved); return next; }); }} onDoubleClick={() => { const title = window.prompt('终端名称', tab.title); if (title) setTerminalTabs((previous) => previous.map((item) => item.id === tab.id ? { ...item, title } : item)); }} className={`group flex h-7 max-w-44 items-center gap-1.5 rounded px-2 text-xs ${tab.id === activeTerminalId ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent'}`} onClick={() => setActiveTerminalId(tab.id)}>
                            <span className={tab.alive ? 'text-success' : 'text-destructive'}>●</span>
                            <span className="truncate">{tab.title}</span>
                            <span role="button" tabIndex={0} className="rounded px-1 opacity-0 hover:bg-accent group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); closeTerminalTab(tab.id); }}>×</span>
                          </button>
                        ))}
                      </div>
                      <select value={terminalProfileName} onChange={(event) => setTerminalProfileName(event.target.value)} className="h-7 max-w-28 rounded border bg-background px-1 text-[10px]">{terminalProfiles.map((profile) => <option key={profile.name}>{profile.name}</option>)}</select>
                      <button type="button" className="rounded px-2 py-1 text-sm hover:bg-accent" onClick={() => createTerminalTab(false)} title="新建终端">＋</button>
                      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => createTerminalTab(true)} title="拆分终端">拆分</button>
                      {splitTerminalId && <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => setSplitTerminalId(null)}>关闭分屏</button>}
                      {!terminalTabs.find((tab) => tab.id === activeTerminalId)?.alive && <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => restartTerminalTab(activeTerminalId)}>重启</button>}
                    </div>
                    <div className="relative flex min-h-0 flex-1">
                      {terminalTabs.map((tab) => (
                        <div key={tab.id} className={`${splitTerminalId ? 'relative w-1/2 border-r' : 'absolute inset-0'} min-h-0`} style={{ display: tab.id === activeTerminalId || tab.id === splitTerminalId ? 'flex' : 'none' }}>
                          <TerminalSingle {...tab} profile={tab.profile} cwd={tab.cwd ?? workspace?.path} theme={resolvedTheme === 'dark' ? 'dark' : 'light'} onTitleChange={(id, title) => setTerminalTabs((previous) => previous.map((item) => item.id === id ? { ...item, title } : item))} onExit={(id, code) => {
                            setTerminalTabs((previous) => previous.map((item) => item.id === id ? { ...item, alive: false, exitCode: code } : item));
                            appendOutput(`终端进程退出，代码 ${code}`);
                          }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bottomPanel.tab === 'problems' && (
                  <div className="py-1">
                    {problems.map((problem, index) => (
                      <button key={`${problem.path}:${problem.line}:${problem.column}:${index}`} type="button" className="flex min-h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent" onClick={() => {
                        const relativePath = problem.path.replace(/^.*?file:\/\//, '').replace(/^\//, '');
                        const document = documents.find((item) => problem.path.endsWith(item.path.replace(/\\/g, '/')));
                        if (document) {
                          pendingRevealRef.current = { path: document.path, line: problem.line, column: problem.column };
                          setActivePath(document.path);
                        } else setStatus(`问题位置：${relativePath}:${problem.line}:${problem.column}`);
                      }}>
                        <span className={problem.severity === monaco.MarkerSeverity.Error ? 'text-destructive' : 'text-warning'}>{problem.severity === monaco.MarkerSeverity.Error ? '●' : '▲'}</span>
                        <span className="min-w-0 flex-1 truncate">{problem.message}</span>
                        <span className="shrink-0 text-muted-foreground">{problem.path.split('/').pop()} [{problem.line}, {problem.column}]</span>
                      </button>
                    ))}
                    {problems.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">未发现问题</div>}
                  </div>
                )}
                {bottomPanel.tab === 'outline' && (
                  <div className="py-1">
                    {symbols.map((symbol) => (
                      <button key={`${symbol.name}:${symbol.line}`} type="button" className="flex h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent" style={{ paddingLeft: 12 + symbol.depth * 14 }} onClick={() => {
                        editorRef.current?.setPosition({ lineNumber: symbol.line, column: symbol.column });
                        editorRef.current?.revealLineInCenter(symbol.line);
                        editorRef.current?.focus();
                      }}>
                        <Code className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate">{symbol.name}</span>
                        <span className="text-muted-foreground">{symbol.detail}</span>
                        <span className="ml-auto text-muted-foreground">:{symbol.line}</span>
                      </button>
                    ))}
                    {symbols.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">当前文档没有可显示的符号</div>}
                  </div>
                )}
                {bottomPanel.tab === 'output' && <pre className="min-h-full whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">{outputLines.join('\n')}</pre>}
                {bottomPanel.tab === 'sourceControl' && (
                  <div className="flex min-h-full flex-col py-1">
                    <div className="flex flex-wrap items-center gap-1 border-b p-2 text-xs">
                      <select value={gitOverview?.branch ?? ''} disabled={!!gitBusy} onChange={(event) => void runGitOperation('switchBranch', { name: event.target.value })} className="h-8 max-w-48 rounded border bg-background px-2">
                        {(gitOverview?.branches ?? []).map((branch) => <option key={branch.name} value={branch.name}>{branch.current ? '✓ ' : ''}{branch.name}</option>)}
                      </select>
                      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!!gitBusy} onClick={() => { const name = window.prompt('新分支名称'); if (name) void runGitOperation('createBranch', { name }); }}>新建分支</Button>
                      {(['fetch', 'pull', 'push', 'sync'] as const).map((operation) => <Button key={operation} size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!gitBusy} onClick={() => void runGitOperation(operation)}>{operation === 'fetch' ? 'Fetch' : operation === 'pull' ? '拉取' : operation === 'push' ? '推送' : '同步'}</Button>)}
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!gitBusy} onClick={() => { const message = window.prompt('Stash 说明（可选）') ?? ''; void runGitOperation('stashPush', { message }); }}>Stash</Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!gitBusy} onClick={() => { const name = window.prompt('Tag 名称'); if (name) void runGitOperation('createTag', { name }); }}>新建 Tag</Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!gitBusy} onClick={() => { const name = window.prompt('Remote 名称', 'origin'); const url = name && window.prompt('Remote URL'); if (name && url) void runGitOperation('addRemote', { name, url }); }}>添加 Remote</Button>
                      {gitBusy && <span className="ml-auto text-muted-foreground">正在执行 {gitBusy}…</span>}
                    </div>
                    <div className="flex h-8 items-center gap-1 border-b px-2 text-xs">
                      {(['changes', 'history', 'stash'] as const).map((view) => <button key={view} type="button" className={`h-full border-b-2 px-2 ${gitView === view ? 'border-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => setGitView(view)}>{view === 'changes' ? `更改 (${gitStatus.length})` : view === 'history' ? `历史 (${gitHistory.length})` : 'Stash / Tags / Remotes'}</button>)}
                    </div>
                    {gitView === 'changes' && <>
                    <div className="flex gap-2 border-b p-2">
                      <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void commitGitChanges(); }} placeholder="提交消息（Ctrl+Enter 提交）" className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none" />
                      <Button size="sm" className="h-8 px-3 text-xs" disabled={!commitMessage.trim() || !gitStatus.some((entry) => entry.status[0] !== ' ' && entry.status[0] !== '?')} onClick={() => void commitGitChanges()}>提交</Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void Promise.all([refreshGitStatus(), refreshGitOverview()])}>刷新</Button>
                    </div>
                    {gitStatus.map((entry) => (
                      <div key={`${entry.status}:${entry.path}`} className="group flex h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent">
                        <span className="w-5 shrink-0 font-mono text-primary">{entry.status.trim() || '?'}</span>
                        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void showGitDiff(entry)} title="查看相对 HEAD 的 Diff">{entry.path}</button>
                        <button type="button" className="rounded px-1.5 py-0.5 opacity-0 hover:bg-background group-hover:opacity-100" onClick={() => void updateGitStage(entry, entry.status[0] === ' ' || entry.status === '??')}>
                          {entry.status[0] !== ' ' && entry.status[0] !== '?' ? '取消暂存' : '暂存'}
                        </button>
                      </div>
                    ))}
                    {gitStatus.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">工作区干净，或当前目录不是 Git 仓库</div>}
                    </>}
                    {gitView === 'history' && <div className="min-h-0 flex-1 overflow-auto py-1">{gitHistory.map((commit) => <button key={commit.hash} type="button" className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent" onClick={async () => {
                      if (!workspace) return;
                      const result = await window.electronAPI.workspace.gitOperation<string>(workspace.path, 'showCommit', { hash: commit.hash });
                      if (result.success) { setOutputLines((previous) => [...previous, `\n=== ${commit.shortHash} ${commit.subject} ===\n${result.data ?? ''}`]); setBottomPanel((previous) => ({ ...previous, tab: 'output' })); }
                    }}><code className="text-primary">{commit.shortHash}</code><span className="min-w-0 flex-1 truncate">{commit.subject}</span><span className="text-muted-foreground">{commit.author} · {new Date(commit.date).toLocaleString()}</span></button>)}</div>}
                    {gitView === 'stash' && <div className="grid grid-cols-[100px_1fr] gap-2 p-3 text-xs">
                      <span>Tags</span><div className="flex items-start gap-2"><span className="flex-1 break-all text-muted-foreground">{gitOverview?.tags.join(', ') || '无'}</span><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const name = window.prompt('要删除的 Tag'); if (name) void runGitOperation('deleteTag', { name }); }}>删除</Button></div>
                      <span>Remotes</span><div className="flex items-start gap-2"><pre className="flex-1 whitespace-pre-wrap text-muted-foreground">{gitOverview?.remotes.join('\n') || '无'}</pre><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const name = window.prompt('要删除的 Remote'); if (name) void runGitOperation('removeRemote', { name }); }}>删除</Button></div>
                      <span>Stash</span><div className="flex gap-1"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => { if (!workspace) return; const result = await window.electronAPI.workspace.gitOperation<Array<{ ref: string; subject: string }>>(workspace.path, 'stashList'); setOutputLines((previous) => [...previous, ...(result.data ?? []).map((item) => `${item.ref} ${item.subject}`)]); setBottomPanel((previous) => ({ ...previous, tab: 'output' })); }}>查看列表</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const ref = window.prompt('Stash 引用', 'stash@{0}'); if (ref) void runGitOperation('stashApply', { ref }); }}>应用</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const ref = window.prompt('Stash 引用', 'stash@{0}'); if (ref) void runGitOperation('stashPop', { ref }); }}>Pop</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => { const ref = window.prompt('要删除的 Stash', 'stash@{0}'); if (ref) void runGitOperation('stashDrop', { ref }); }}>删除</Button></div>
                    </div>}
                  </div>
                )}
                {bottomPanel.tab === 'ai' && (
                  <div className="flex h-full min-h-0 flex-col gap-2 p-3">
                    <div className="text-xs text-muted-foreground">描述希望对当前文件执行的修改。AI 结果会先进入 Diff，不会自动保存。</div>
                    <div className="flex items-center gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={aiMultiFile} onChange={(event) => setAiMultiFile(event.target.checked)} />多文件 Agent（自动筛选相关文件）</label><span className="text-muted-foreground">待审阅 {aiProposals.length}</span><span className="text-muted-foreground">已接受 {aiHistory.length}</span><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={aiHistory.length === 0} onClick={undoLastAiEdit}>撤销上次 AI 修改</Button></div>
                    <textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="例如：重构这个组件，拆分重复逻辑并补充错误处理" className="min-h-20 flex-1 resize-none rounded border bg-background p-2 text-xs outline-none" />
                    <div className="flex justify-end">
                      <Button size="sm" disabled={!activeDocument || !aiInstruction.trim() || aiEditing} onClick={() => void generateAiEdit()}>{aiEditing ? '生成中…' : '生成修改并预览'}</Button>
                    </div>
                  </div>
                )}
                {bottomPanel.tab === 'settings' && (
                  <div className="grid max-w-2xl grid-cols-[180px_1fr] items-center gap-x-4 gap-y-3 p-4 text-xs">
                    <label htmlFor="editor-font-size">字体大小</label>
                    <input id="editor-font-size" type="number" min={10} max={32} value={preferences.fontSize} onChange={(event) => setPreferences((previous) => ({ ...previous, fontSize: Number(event.target.value) || 13 }))} className="h-8 rounded border bg-background px-2" />
                    <label htmlFor="editor-tab-size">Tab Size</label>
                    <select id="editor-tab-size" value={preferences.tabSize} onChange={(event) => setPreferences((previous) => ({ ...previous, tabSize: Number(event.target.value) }))} className="h-8 rounded border bg-background px-2"><option value={2}>2</option><option value={4}>4</option><option value={8}>8</option></select>
                    <span>自动换行</span><input type="checkbox" checked={preferences.wordWrap === 'on'} onChange={(event) => setPreferences((previous) => ({ ...previous, wordWrap: event.target.checked ? 'on' : 'off' }))} />
                    <span>Minimap</span><input type="checkbox" checked={preferences.minimap} onChange={(event) => setPreferences((previous) => ({ ...previous, minimap: event.target.checked }))} />
                    <span>保存时格式化</span><input type="checkbox" checked={preferences.formatOnSave} onChange={(event) => setPreferences((previous) => ({ ...previous, formatOnSave: event.target.checked }))} />
                    <label htmlFor="terminal-profile">默认终端 Profile</label><select id="terminal-profile" value={terminalProfileName} onChange={(event) => setTerminalProfileName(event.target.value)} className="h-8 rounded border bg-background px-2">{terminalProfiles.map((profile) => <option key={profile.name}>{profile.name}</option>)}</select>
                    <label htmlFor="terminal-env">终端环境变量</label><textarea id="terminal-env" value={terminalEnvText} onChange={(event) => setTerminalEnvText(event.target.value)} placeholder={'KEY=value\nANOTHER=value'} className="min-h-20 rounded border bg-background p-2 font-mono text-xs" />
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-primary px-3 text-[11px] text-primary-foreground">
        <span className="max-w-48 truncate">{workspace?.name ?? '无工作区'}</span>
        <span className="flex-1 truncate opacity-90">{status}</span>
        {activeDocument && (
          <>
            <span>Ln {position.line}, Col {position.column}</span>
            <button type="button" onClick={() => setBottomPanel({ open: true, tab: 'settings', height: 220 })}>Spaces: {preferences.tabSize}</button>
            <span>{encodingLabel(activeDocument.encoding)}</span>
            <span>{activeDocument.lineEnding}{activeDocument.mixedLineEndings ? ' (混合)' : ''}</span>
            {activeDocument.readOnly && <span>只读</span>}
            <span>{languageFromName(activeDocument.name)}</span>
          </>
        )}
      </footer>

      {treeMenu && (
        <div className="fixed inset-0 z-50" onMouseDown={() => setTreeMenu(null)}>
          <div
            className="fixed min-w-44 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg"
            style={{ left: treeMenu.x, top: treeMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => beginRename(treeMenu.node)}>重命名</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { setTreeClipboard({ node: treeMenu.node, cut: false }); setTreeMenu(null); }}>复制</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { setTreeClipboard({ node: treeMenu.node, cut: true }); setTreeMenu(null); }}>剪切</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={!treeClipboard} onClick={() => { void pasteTreeEntry(treeMenu.node); setTreeMenu(null); }}>粘贴</button>
            {treeMenu.node.type === 'file' && <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => void showGitDiff({ path: treeMenu.node.path, status: ' M' })}>与 HEAD 比较</button>}
            {treeMenu.node.type === 'file' && <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => void showFileTimeline(treeMenu.node)}>文件时间线</button>}
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { if (workspace) void window.electronAPI.workspace.revealEntry(workspace.path, treeMenu.node.path); setTreeMenu(null); }}>在文件管理器中显示</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { if (workspace) void navigator.clipboard.writeText(`${workspace.path}\\${treeMenu.node.path}`); setTreeMenu(null); }}>复制路径</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { void navigator.clipboard.writeText(treeMenu.node.path); setTreeMenu(null); }}>复制相对路径</button>
            <div className="my-1 border-t" />
            <button type="button" className="w-full px-3 py-1.5 text-left text-destructive hover:bg-accent" onClick={() => { void deleteSelected(treeMenu.node); setTreeMenu(null); }}>移到回收站</button>
          </div>
        </div>
      )}

      {tabMenu && (() => {
        const document = documents.find((item) => item.path === tabMenu.path);
        const index = documents.findIndex((item) => item.path === tabMenu.path);
        if (!document) return null;
        return (
          <div className="fixed inset-0 z-50" onMouseDown={() => setTabMenu(null)}>
            <div
              className="fixed min-w-44 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg"
              style={{ left: tabMenu.x, top: tabMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => {
                setDocuments((previous) => previous.map((item) => item.path === document.path ? { ...item, pinned: item.pinned === false } : item));
                setTabMenu(null);
              }}>
                {document.pinned === false ? '固定标签' : '取消固定'}
              </button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { setSecondaryPath(document.path); setTabMenu(null); }}>
                在右侧打开
              </button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocument(document.path); setTabMenu(null); }}>关闭</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocumentSet(documents.filter((item) => item.path !== document.path).map((item) => item.path)); setTabMenu(null); }}>关闭其他</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={index === documents.length - 1} onClick={() => { closeDocumentSet(documents.slice(index + 1).map((item) => item.path)); setTabMenu(null); }}>关闭右侧</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocumentSet(documents.filter((item) => item.content === item.savedContent).map((item) => item.path)); setTabMenu(null); }}>关闭已保存</button>
            </div>
          </div>
        );
      })()}

      {diffView && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
            <span className="font-semibold">{diffView.name}</span>
            <span className="text-muted-foreground">{diffView.source === 'ai' ? '修改前 ↔ AI 候选' : diffView.source === 'git' ? 'HEAD ↔ 工作区' : diffView.source === 'merge' ? '当前分支 ↔ 传入分支' : '磁盘版本 ↔ 本地版本'}</span>
            <div className="flex-1" />
            {diffView.source === 'git' && gitHunks.slice(0, 8).map((hunk, index) => <Button key={hunk.label} size="sm" variant="outline" className="h-7 max-w-32 truncate px-2 text-xs" title={hunk.label} onClick={() => void stageGitHunk(hunk)}>暂存块 {index + 1}</Button>)}
            {diffView.source === 'merge' && <><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void resolveGitConflict('ours')}>接受当前分支</Button><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void resolveGitConflict('theirs')}>接受传入分支</Button></>}
            {diffView.source === 'ai' && (
              <Button size="sm" className="h-7 px-3 text-xs" onClick={acceptAiEdit}>接受修改</Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => diffView.source === 'ai' ? rejectAiEdit() : setDiffView(null)}>
              {diffView.source === 'ai' ? '拒绝修改' : '关闭比较'}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              original={diffView.original}
              modified={diffView.modified}
              language={diffView.language}
              originalModelPath={`file:///${diffView.path.replace(/\\/g, '/')}?disk`}
              modifiedModelPath={`file:///${diffView.path.replace(/\\/g, '/')}?local`}
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
              options={{
                automaticLayout: true,
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
              }}
            />
          </div>
        </div>
      )}

      <SearchPanel
        searchPanel={searchPanel}
        setSearchPanel={setSearchPanel}
        runSearch={runSearch}
        replaceAllSearchResults={replaceAllSearchResults}
        openSearchResult={openSearchResult}
        replaceResults={replaceSearchResults}
        undoReplace={undoSearchReplace}
        canUndoReplace={replaceHistory.length > 0}
      />

      <QuickOpenPanel
        quickOpen={quickOpen}
        setQuickOpen={setQuickOpen}
        quickOpenResults={quickOpenResults}
        openTreeFile={openTreeFile}
      />
    </div>
  );
};
