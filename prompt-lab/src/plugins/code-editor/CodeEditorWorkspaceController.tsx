import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
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
import { useStore } from '@/store';
import type {
  FilePickResult,
  WorkspaceEncoding,
  WorkspaceGitStatus,
  WorkspaceGitCommit,
} from '@/types/electron';
import { decodeBase64Utf8, hasGitConflictMarkers, languageFromName, languageIdFromName } from './editor-utils';
import { DialogOverlay } from './DialogOverlay';
import { BottomPanel } from './BottomPanel';
import { DiffViewPanel } from './DiffViewPanel';
import { FileTreeRow } from './FileTreeRow';
import { SearchPanel } from './SearchPanel';
import { QuickOpenPanel } from './QuickOpenPanel';
import { estimateTokens } from './ai-context';
import { useTerminalTasks } from './useTerminalTasks';
import { useGitRepository } from './useGitRepository';
import { useWorkspaceSearch } from './useWorkspaceSearch';
import { useEditorIntelligence } from './useEditorIntelligence';
import { useAiSessionState, type AiFileProposal } from './useAiSessionState';
import { useGitDiffMerge } from './useGitDiffMerge';
import { useAiProposalReview } from './useAiProposalReview';
import { useAiEditGeneration } from './useAiEditGeneration';
import {
  type BottomPanelTab,
  type EditorPreferences,
  type EditorProblem,
  type EditorSymbol,
  type OpenDocument,
  type TreeNode,
  type TreeEditState,
  type AiHunk,
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

function computeDiffHunks(original: string, modified: string): AiHunk[] {
  const o = original.split('\n');
  const m = modified.split('\n');
  const hunks: AiHunk[] = [];
  let oIdx = 0;
  let mIdx = 0;
  let hunkIdx = 0;

  while (oIdx < o.length || mIdx < m.length) {
    while (oIdx < o.length && mIdx < m.length && o[oIdx] === m[mIdx]) { oIdx += 1; mIdx += 1; }
    if (oIdx >= o.length && mIdx >= m.length) break;

    const originalStart = oIdx + 1;
    const modifiedStart = mIdx + 1;
    const originalLines: string[] = [];
    const modifiedLines: string[] = [];

    while (oIdx < o.length) {
      const lookAhead = m.slice(mIdx, mIdx + 8);
      if (lookAhead.includes(o[oIdx])) break;
      originalLines.push(o[oIdx]);
      oIdx += 1;
    }
    while (mIdx < m.length) {
      const lookAhead = o.slice(oIdx, oIdx + 8);
      if (lookAhead.includes(m[mIdx])) break;
      modifiedLines.push(m[mIdx]);
      mIdx += 1;
    }

    if (originalLines.length > 0 || modifiedLines.length > 0) {
      hunks.push({ index: hunkIdx, originalStart, modifiedStart, originalLines, modifiedLines });
      hunkIdx += 1;
    } else {
      if (oIdx < o.length) { originalLines.push(o[oIdx]); oIdx += 1; }
      if (mIdx < m.length) { modifiedLines.push(m[mIdx]); mIdx += 1; }
      hunks.push({ index: hunkIdx, originalStart, modifiedStart, originalLines, modifiedLines });
      hunkIdx += 1;
    }
  }
  return hunks;
}
export const CodeEditorWorkspaceController: React.FC = () => {
  const { theme, aiApi } = useStore();
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const [workspace, setWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [workspaceFolders, setWorkspaceFolders] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [treeEdit, setTreeEdit] = useState<TreeEditState | null>(null);
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [treeClipboard, setTreeClipboard] = useState<{ nodes: TreeNode[]; cut: boolean } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [secondaryPath, setSecondaryPath] = useState<string | null>(null);
  const [diffView, setDiffView] = useState<{
    path: string;
    name: string;
    original: string;
    modified: string;
    language: string;
    source?: 'external' | 'git' | 'merge' | 'ai' | 'search';
  } | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(180, Math.min(520, Number(localStorage.getItem('code-editor.sidebar-width')) || 240)));
  const [explorerFilter, setExplorerFilter] = useState('');
  const [explorerSort, setExplorerSort] = useState<'name' | 'type'>(() => (localStorage.getItem('code-editor.explorer-sort') as 'name' | 'type') || 'name');
  const [recentWorkspaces, setRecentWorkspaces] = useState<Array<{ path: string; name: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('code-editor.recent-workspaces') ?? '[]'); } catch { return []; }
  });
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
  const [outputLines, setOutputLines] = useState<string[]>(['代码编辑器已就绪']);
  const [status, setStatus] = useState('就绪');
  const [dialog, setDialog] = useState<{ type: 'prompt'; title: string; defaultValue?: string; resolve: (value: string | null) => void } | { type: 'confirm'; message: string; resolve: (ok: boolean) => void } | null>(null);
  const appPrompt = useCallback((title: string, defaultValue = ''): Promise<string | null> => new Promise((resolve) => {
    setDialog({ type: 'prompt', title, defaultValue, resolve });
  }), []);

  const appConfirm = useCallback((message: string): Promise<boolean> => new Promise((resolve) => {
    setDialog({ type: 'confirm', message, resolve });
  }), []);
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; query: string; files: TreeNode[] }>({
    open: false, query: '', files: [],
  });
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

  const {
    aiInstruction, setAiInstruction, aiEditing, setAiEditing, inlineEdit, setInlineEdit,
    aiSessions, aiMultiFile, setAiMultiFile, aiProposals, setAiProposals,
    aiTokenBudget, setAiTokenBudget, aiHistory, setAiHistory, aiHunks, setAiHunks,
    aiMessages, setAiMessages, aiPendingRequest, setAiPendingRequest,
    recordAiSession, updateSessionAcceptCount,
  } = useAiSessionState({ workspace, appendOutput });

  const openExternalDiff = useCallback((value: { path: string; name: string; modified: string }) => {
    setDiffView({ ...value, original: '', language: 'diff', source: 'external' });
  }, []);
  const git = useGitRepository({
    workspace,
    sourceControlVisible: bottomPanel.open && bottomPanel.tab === 'sourceControl',
    appendOutput,
    setStatus,
    openExternalDiff,
  });
  const {
    gitStatus, gitOverview, gitHistory, setGitHistory, gitView, setGitView, gitBusy,
    pullStrategy, setPullStrategy, commitMessage, setCommitMessage,
    refreshGitStatus, refreshGitOverview, runGitOperation,
    loadGitHistory, compareGitCommits, cancelGitOp,
  } = git;

  const {
    gitHunks, mergeHunks, setMergeHunks, mergeBase, setMergeBase,
    mergeResult, setMergeResult, mergeInitialResult, setMergeInitialResult,
    mergeConflictPaths, showGitDiff, stageGitHunk, unstageFile,
    resolveGitConflict, applyMergeHunk, finishMerge,
  } = useGitDiffMerge({
    workspace,
    diffView,
    setDiffView,
    setDocuments,
    setStatus,
    appendOutput,
    refreshGitStatus,
    computeDiffHunks,
  });

  const {
    acceptAiEdit, rejectAiEdit, acceptAllAiEdits, applyAiHunk, undoLastAiEdit,
  } = useAiProposalReview({
    workspace,
    documents,
    setDocuments,
    setActivePath,
    diffView,
    setDiffView,
    aiProposals,
    setAiProposals,
    aiHistory,
    setAiHistory,
    aiHunks,
    setAiHunks,
    computeDiffHunks,
    updateSessionAcceptCount,
    appendOutput,
    setStatus,
  });

  const { generateAiEdit, runInlineEdit } = useAiEditGeneration({
    aiApi,
    workspace,
    documents,
    activeDocument: documents.find((document) => document.path === activePath) ?? null,
    editorRef,
    aiInstruction,
    aiMessages,
    setAiMessages,
    aiMultiFile,
    aiTokenBudget,
    inlineEdit,
    setInlineEdit,
    setAiEditing,
    setAiPendingRequest,
    setAiProposals,
    setDiffView,
    setDocuments,
    recordAiSession,
    appendOutput,
    setStatus,
  });

  const terminalTasks = useTerminalTasks({ workspace, appPrompt, appendOutput, setStatus, setBottomPanel });
  const {
    taskProblems, workspaceTasks, taskRun, taskHistory,
    terminalProfiles, terminalProfileName, setTerminalProfileName,
    terminalEnvText, setTerminalEnvText,
    renamingTerminalId, setRenamingTerminalId,
    renamingTerminalTitle, setRenamingTerminalTitle,
    showEnvValues, setShowEnvValues,
    terminalTabs, setTerminalTabs,
    activeTerminalId, setActiveTerminalId,
    splitTerminalId, setSplitTerminalId,
    addTerminalProfile, saveTerminalSecret,
    createTerminalTab, closeTerminalTab, restartTerminalTab,
    handleTerminalOutput, runWorkspaceTask, cancelWorkspaceTask,
  } = terminalTasks;


  const activeDocument = documents.find((document) => document.path === activePath) ?? null;
  const secondaryDocument = documents.find((document) => document.path === secondaryPath) ?? null;
  const hasDirtyDocuments = documents.some((document) => document.content !== document.savedContent);
  const {
    problems, symbols, position, refreshProblems, refreshSymbols, handleMount,
  } = useEditorIntelligence({
    editorRef,
    workspace,
    activePath,
    activeDocument,
    appConfirm,
    setDocuments,
    setStatus,
  });
  const allProblems = useMemo(() => [...problems, ...taskProblems], [problems, taskProblems]);
  const visibleTreeNodes = useMemo(() => {
    const result: TreeNode[] = [];
    const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
      result.push(node);
      if (node.children) visit(node.children);
    });
    visit(tree);
    return result;
  }, [tree]);
  const displayedTree = useMemo(() => {
    const query = explorerFilter.trim().toLocaleLowerCase();
    const visit = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((node) => {
      const children = node.children ? visit(node.children) : undefined;
      if (query && !node.name.toLocaleLowerCase().includes(query) && !children?.length) return [];
      return [{ ...node, children }];
    }).sort((a, b) => explorerSort === 'type' ? (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    return visit(tree);
  }, [explorerFilter, explorerSort, tree]);
  const treeDecorations = useMemo(() => {
    const result = new Map<string, { git?: string; errors?: number; warnings?: number }>();
    for (const entry of gitStatus) {
      const path = visibleTreeNodes.find((node) => node.path.replace(/\\/g, '/') === entry.path.replace(/\\/g, '/'))?.path ?? entry.path;
      result.set(path, { ...result.get(path), git: entry.status });
    }
    for (const problem of allProblems) {
      const path = [...visibleTreeNodes].find((node) => problem.path.replace(/\\/g, '/').endsWith(node.path.replace(/\\/g, '/')))?.path;
      if (!path) continue;
      const current = result.get(path) ?? {};
      if (problem.severity === monaco.MarkerSeverity.Error) current.errors = (current.errors ?? 0) + 1;
      else if (problem.severity === monaco.MarkerSeverity.Warning) current.warnings = (current.warnings ?? 0) + 1;
      result.set(path, current);
    }
    return result;
  }, [allProblems, gitStatus, visibleTreeNodes]);
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

  const openWorkspace = useCallback(async (addToExisting = false) => {
    if (!addToExisting && hasDirtyDocuments && !await appConfirm('当前工作区有未保存的修改，仍要打开其他文件夹吗？')) return;
    try {
      const folder = await window.electronAPI.workspace.openFolder();
      if (!folder) return;
      setStatus('正在读取工作区…');
      const entries = await loadDirectory(folder.path);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (addToExisting && workspace) {
        setWorkspaceFolders((prev) => [...prev, { id, path: folder.path, name: folder.name }]);
      } else {
        setWorkspace(folder);
        setActiveFolderId(id);
        setWorkspaceFolders([{ id, path: folder.path, name: folder.name }]);
        setDocuments([]);
        setActivePath(null);
        setExpandedPaths(new Set());
      }
      setTree(entries);
      setSelectedNode(null);
      setStatus(`已${addToExisting ? '添加' : '打开'} ${folder.name}`);
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
    if (!await appConfirm(`确定将“${node.name}”移到系统回收站吗？`)) return;
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
    if (!await appConfirm(`确定将所选 ${paths.length} 个项目移到系统回收站吗？`)) return;
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
    let completed = 0;
    let skipped = 0;
    for (const node of treeClipboard.nodes) {
      let nextPath = parent ? `${parent}/${node.name}` : node.name;
      if (nextPath === node.path || nextPath.startsWith(`${node.path}/`) || nextPath.startsWith(`${node.path}\\`)) { skipped += 1; continue; }
      let result = treeClipboard.cut ? await window.electronAPI.workspace.renameEntry(workspace.path, node.path, nextPath) : await window.electronAPI.workspace.copyEntry(workspace.path, node.path, nextPath);
      // Auto-rename on conflict: append " - Copy" counter
      if (!result.success && result.error === 'ALREADY_EXISTS') {
        let counter = 1;
        const ext = node.name.includes('.') ? node.name.slice(node.name.lastIndexOf('.')) : '';
        const base = ext ? node.name.slice(0, node.name.lastIndexOf('.')) : node.name;
        while (counter < 100) {
          const renamed = `${base} - Copy${counter > 1 ? ` (${counter})` : ''}${ext}`;
          const renamedPath = parent ? `${parent}/${renamed}` : renamed;
          result = treeClipboard.cut ? await window.electronAPI.workspace.renameEntry(workspace.path, node.path, renamedPath) : await window.electronAPI.workspace.copyEntry(workspace.path, node.path, renamedPath);
          if (result.success) { nextPath = renamedPath; break; }
          if (result.error !== 'ALREADY_EXISTS') break;
          counter += 1;
        }
      }
      if (!result.success) { setStatus(`粘贴失败：${node.name} — ${displayError(result.error)}`); return; }
      if (treeClipboard.cut) remapOpenPaths(node.path, nextPath);
      completed += 1;
    }
    if (treeClipboard.cut) setTreeClipboard(null);
    await refreshWorkspaceTree();
    setStatus(`已${treeClipboard.cut ? '移动' : '复制'} ${completed} 个项目${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`);
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

  const closeDocument = useCallback(async (path: string) => {
    const document = documents.find((item) => item.path === path);
    if (!document) return;
    if (document.content !== document.savedContent && !await appConfirm(`“${document.name}”尚未保存，仍要关闭吗？`)) return;
    const index = documents.findIndex((item) => item.path === path);
    const remaining = documents.filter((item) => item.path !== path);
    setDocuments(remaining);
    if (secondaryPath === path) setSecondaryPath(null);
    if (activePath === path) {
      setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
    }
  }, [activePath, documents, secondaryPath]);

  const closeDocumentSet = useCallback(async (paths: string[]) => {
    const pathSet = new Set(paths);
    const dirty = documents.filter((document) => (
      pathSet.has(document.path) && document.content !== document.savedContent
    ));
    if (dirty.length > 0 && !await appConfirm(`${dirty.length} 个文件尚未保存，仍要关闭吗？`)) return;
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

  const openSearchResultFile = useCallback(async (result: { path: string; line: number; column: number }) => {
    pendingRevealRef.current = { path: result.path, line: result.line, column: result.column };
    await openTreeFile({
      name: result.path.split(/[\\/]/).pop() ?? result.path,
      path: result.path,
      type: 'file',
    });
  }, [openTreeFile]);

  const {
    searchPanel, setSearchPanel, replaceHistory, searchPreviews, runSearch, previewSearchReplace,
    acceptSearchReplace, rejectSearchReplace, replaceAllSearchResults,
    replaceSearchResults, undoSearchReplace, openSearchResult,
  } = useWorkspaceSearch({
    workspace,
    diffView,
    setDiffView,
    setDocuments,
    appConfirm,
    appendOutput,
    setStatus,
    markRecentlySaved: (path) => recentlySavedRef.current.set(path, Date.now()),
    openResult: openSearchResultFile,
  });
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
          folders?: Array<{ id: string; path: string; name: string }>;
          openPaths?: string[];
          activePath?: string | null;
          sidebarVisible?: boolean;
          drafts?: Record<string, { content: string; pinned?: boolean }>;
          pinned?: Record<string, boolean>;
          viewStates?: Record<string, monaco.editor.ICodeEditorViewState | null>;
          expandedPaths?: string[];
          autoSave?: boolean;
          terminals?: Array<{ id: string; title: string; cwd?: string; profileName?: string; alive: boolean }>;
          activeTerminalId?: string;
          splitTerminalId?: string | null;
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
        if (session.folders) setWorkspaceFolders(session.folders);
        else setWorkspaceFolders(session.workspace ? [{ id: `${Date.now()}`, path: session.workspace.path, name: session.workspace.name }] : []);
        void window.electronAPI.workspace.reauthorize(session.workspace.path).catch(() => undefined);
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
        // Restore terminal tabs if session had them
        if (session.terminals?.length) {
          setTerminalTabs(session.terminals.map((t) => ({
            ...t,
            alive: false,
            profile: t.profileName ? terminalProfiles.find((p) => p.name === t.profileName) ?? terminalProfiles[0] : undefined,
          })));
          setActiveTerminalId(session.activeTerminalId ?? session.terminals[0].id);
          if (session.splitTerminalId) setSplitTerminalId(session.splitTerminalId);
        }
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
        folders: workspaceFolders,
        openPaths: documents.filter((document) => !document.standalone).map((document) => document.path),
        activePath: activeDocument?.standalone ? null : activePath,
        sidebarVisible,
        drafts,
        pinned: Object.fromEntries(documents.map((document) => [document.path, document.pinned !== false])),
        viewStates: viewStatesRef.current,
        expandedPaths: [...expandedPaths],
        autoSave,
        terminals: terminalTabs.map((t) => ({ id: t.id, title: t.title, cwd: t.cwd, profileName: t.profile?.name, alive: t.alive })),
        activeTerminalId,
        splitTerminalId,
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

  const closeDiffView = useCallback(async () => {
    if (!diffView) return;
    if (diffView.source === 'ai') {
      rejectAiEdit();
      return;
    }
    if (diffView.source === 'search') {
      rejectSearchReplace();
      return;
    }
    if (diffView.source === 'merge') {
      if (mergeResult !== mergeInitialResult && !await appConfirm('Result 有未保存的合并修改，确定关闭吗？')) return;
      setMergeHunks([]);
      setMergeBase(null);
      setMergeResult(null);
      setMergeInitialResult(null);
    }
    setDiffView(null);
  }, [appConfirm, diffView, mergeInitialResult, mergeResult, rejectAiEdit, rejectSearchReplace]);

  // Compute hunks whenever an AI or merge diff view is opened
  useEffect(() => {
    if (diffView?.source === 'ai') {
      setAiHunks(computeDiffHunks(diffView.original, diffView.modified));
    } else if (diffView?.source === 'merge') {
      setMergeHunks(computeDiffHunks(diffView.original, diffView.modified));
    }
  }, [diffView]);

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
      Promise.all([
        window.electronAPI.workspace.gitOperation<string>(workspace.path, 'fileDiff', { path: activeDocument.path }),
        window.electronAPI.workspace.gitOperation<string>(workspace.path, 'fileDiff', { path: activeDocument.path, staged: true }).catch(() => ({ success: false, data: '' }) as const),
      ]).then(([unstaged, staged]) => {
        if (cancelled || !editorRef.current) return;
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        const addHunk = (patch: string, prefix: string) => {
          for (const line of patch.split('\n')) {
            const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
            if (!match) continue;
            const oldCount = Number(match[1] ?? 1);
            const start = Number(match[2]);
            const newCount = Number(match[3] ?? 1);
            const kind = newCount === 0 ? 'deleted' : oldCount === 0 ? 'added' : 'modified';
            const count = Math.max(1, newCount);
            decorations.push({
              range: new monaco.Range(Math.max(1, start), 1, Math.max(1, start + count - 1), 1),
              options: {
                isWholeLine: true,
                className: `git-line-${prefix}-${kind}`,
                linesDecorationsClassName: `git-gutter-${prefix}-${kind}`,
                overviewRuler: { color: prefix === 'staged' ? '#a78bfa' : kind === 'added' ? '#22c55e' : kind === 'deleted' ? '#ef4444' : '#3b82f6', position: monaco.editor.OverviewRulerLane.Left },
              },
            });
          }
        };
        if (unstaged.success) addHunk(unstaged.data ?? '', 'unstaged');
        if (staged.success) addHunk(staged.data ?? '', 'staged');
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
        setInlineEdit({ instruction: '', visible: false });
      }
      if (command && event.key.toLowerCase() === 'k' && activeDocument && !activeDocument.readOnly) {
        event.preventDefault();
        const sel = editorRef.current?.getSelection();
        const hasSelection = sel && !sel.isEmpty();
        setInlineEdit({ instruction: '', visible: true });
        if (hasSelection) setStatus('已选中代码，输入 AI 修改指令后回车');
        else setStatus('输入 AI 生成指令后回车');
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

  const runSemanticSearch = useCallback(async () => {
    if (!workspace) return;
    const model = editorRef.current?.getModel();
    const cursor = editorRef.current?.getPosition();
    const word = model && cursor ? model.getWordAtPosition(cursor)?.word ?? '' : '';
    const languageServiceSupported = Boolean(activeDocument && cursor && /\.[cm]?[jt]sx?$/i.test(activeDocument.path) && word);
    const symbol = languageServiceSupported ? word : await appPrompt('搜索符号、引用和 import 图', word);
    if (!symbol) return;
    setSearchPanel((previous) => ({ ...previous, open: true, query: symbol, loading: true, results: [] }));
    const result = languageServiceSupported
      ? await window.electronAPI.workspace.languageSemanticSearch(workspace.path, activeDocument!.path, cursor!.lineNumber, cursor!.column)
      : await window.electronAPI.workspace.semanticSearch(workspace.path, symbol);
    setSearchPanel((previous) => ({
      ...previous,
      loading: false,
      results: (result.data ?? []).map((item) => ({ ...item, preview: `[${item.kind}${item.importedFrom ? ` ← ${item.importedFrom}` : ''}] ${item.preview}` })),
    }));
    setStatus(result.success ? `${languageServiceSupported ? 'Language Service' : '语义'} 搜索找到 ${result.data?.length ?? 0} 项` : `语义搜索失败：${displayError(result.error)}`);
  }, [activeDocument, appPrompt, workspace]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSidebarVisible((value) => !value)} title="切换资源管理器 (Ctrl+B)">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void openWorkspace(false)}>
          <FolderOpen className="h-4 w-4" /> 打开文件夹
        </Button>
        {workspace && <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void openWorkspace(true)}>
          <Plus className="h-3.5 w-3.5" /> 添加文件夹
        </Button>}
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
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!workspace} onClick={() => void runSemanticSearch()} title="跨工作区搜索定义、引用和 import">语义搜索</Button>
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
              <button type="button" className="rounded px-1 text-[9px] hover:bg-accent" onClick={() => setExplorerSort((s) => s === 'name' ? 'type' : 'name')} title="排序方式">{explorerSort === 'name' ? 'A-Z' : 'Type'}</button>
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
                {workspaceFolders.length > 1 && <div className="flex gap-0.5 border-b px-1 py-1">{workspaceFolders.map((f) => <button key={f.id} type="button" className={`group flex items-center truncate rounded px-2 py-0.5 text-[10px] ${f.path === workspace.path ? 'bg-accent' : 'hover:bg-accent/50'}`} onClick={async () => { if (f.path === workspace.path) return; setStatus(`切换到 ${f.name}…`); const entries = await loadDirectory(f.path); setWorkspace({ path: f.path, name: f.name }); setTree(entries); setExpandedPaths(new Set()); setActiveFolderId(f.id); setStatus(`已切换至 ${f.name}`); }} title={f.path}>{f.name}<span className="ml-1 hidden group-hover:inline hover:text-destructive" onClick={async (e) => { e.stopPropagation(); if (f.path === workspace.path) { const next = workspaceFolders.find((x) => x.path !== f.path); if (next) { const entries = await loadDirectory(next.path); setWorkspace({ path: next.path, name: next.name }); setTree(entries); } else { setWorkspace(null); setTree([]); } } setWorkspaceFolders((prev) => prev.filter((x) => x.id !== f.id)); }}>×</span></button>)}</div>}
                <div className="px-2 pb-1">
                  <input value={explorerFilter} onChange={(e) => setExplorerFilter(e.target.value)} placeholder="过滤文件…" className="h-6 w-full rounded border bg-background px-2 text-[10px] outline-none" />
                </div>
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
                    onEditChange={(value: string) => setTreeEdit((previous) => previous ? { ...previous, value } : previous)}
                    onEditCommit={(): void => { void commitTreeEdit(); }}
                    onEditCancel={() => setTreeEdit(null)}
                    onContextMenu={(event: React.MouseEvent, current: TreeNode) => {
                      event.preventDefault();
                      if (!selectedPaths.has(current.path)) {
                        setSelectedPaths(new Set([current.path]));
                        setSelectedNode(current);
                      }
                      setTreeMenu({ x: event.clientX, y: event.clientY, node: current });
                    }}
                    onMove={(source: TreeNode, target: TreeNode): void => { void moveTreeEntry(source, target); }}
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
              {inlineEdit.visible && (
                <div className="absolute top-1 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-lg">
                  <input autoFocus value={inlineEdit.instruction} onChange={(e) => setInlineEdit((p) => ({ ...p, instruction: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') void runInlineEdit(); if (e.key === 'Escape') setInlineEdit({ instruction: '', visible: false }); }} placeholder="AI 内联修改指令…" className="h-7 w-64 rounded border bg-background px-2 text-xs outline-none" />
                  <Button size="sm" className="h-7 px-3 text-xs" disabled={!inlineEdit.instruction.trim() || aiEditing} onClick={() => void runInlineEdit()}>{aiEditing ? '…' : '生成'}</Button>
                  <kbd className="text-[10px] text-muted-foreground">Ctrl+K</kbd>
                </div>
              )}
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
                <Button variant="outline" size="sm" onClick={() => void openWorkspace(false)}>打开文件夹</Button>
                <Button variant="outline" size="sm" onClick={openStandaloneFile}>打开文件</Button>
              </div>
            </div>
          )}

        </main>
      </div>

      <BottomPanel
        bottomPanel={bottomPanel} setBottomPanel={setBottomPanel}
        terminalTabs={terminalTabs} setTerminalTabs={setTerminalTabs}
        activeTerminalId={activeTerminalId} setActiveTerminalId={setActiveTerminalId}
        splitTerminalId={splitTerminalId} setSplitTerminalId={setSplitTerminalId}
        terminalProfileName={terminalProfileName} setTerminalProfileName={setTerminalProfileName}
        terminalProfiles={terminalProfiles}
        addTerminalProfile={addTerminalProfile}
        saveTerminalSecret={saveTerminalSecret}
        workspaceTasks={workspaceTasks}
        taskRun={taskRun}
        taskHistory={taskHistory} cancelWorkspaceTask={cancelWorkspaceTask}
        renamingTerminalId={renamingTerminalId} renamingTerminalTitle={renamingTerminalTitle}
        setRenamingTerminalId={setRenamingTerminalId} setRenamingTerminalTitle={setRenamingTerminalTitle}
        createTerminalTab={createTerminalTab} closeTerminalTab={closeTerminalTab}
        restartTerminalTab={restartTerminalTab}
        runWorkspaceTask={runWorkspaceTask} handleTerminalOutput={handleTerminalOutput}
        appendOutput={appendOutput} workspacePath={workspace?.path} resolvedTheme={resolvedTheme}
        allProblems={allProblems} documents={documents} pendingRevealRef={pendingRevealRef}
        setActivePath={setActivePath} setStatus={setStatus} setAiInstruction={setAiInstruction}
        symbols={symbols} editorRef={editorRef} outputLines={outputLines}
        gitOverview={gitOverview} gitBusy={gitBusy}
        pullStrategy={pullStrategy} setPullStrategy={setPullStrategy}
        runGitOperation={runGitOperation} appPrompt={appPrompt} appConfirm={appConfirm}
        cancelGitOp={() => { if (workspace && gitBusy) void window.electronAPI.workspace.cancelGitOperation(workspace.path, gitBusy.operationId); }}
        gitView={gitView} setGitView={setGitView}
        gitStatus={gitStatus} gitHistory={gitHistory}
        loadGitHistory={loadGitHistory} compareGitCommits={compareGitCommits}
        commitMessage={commitMessage} setCommitMessage={setCommitMessage}
        commitGitChanges={commitGitChanges}
        refreshGitStatus={refreshGitStatus} refreshGitOverview={refreshGitOverview}
        showGitDiff={showGitDiff} updateGitStage={updateGitStage}
        setDiffView={setDiffView}
        aiMultiFile={aiMultiFile} setAiMultiFile={setAiMultiFile}
        aiProposals={aiProposals} aiHistory={aiHistory} aiSessions={aiSessions}
        aiTokenBudget={aiTokenBudget} setAiTokenBudget={setAiTokenBudget} aiEstimatedTokens={estimateTokens(`${aiInstruction}\n${activeDocument?.content ?? ''}`)}
        aiMessages={aiMessages} aiPendingRequest={aiPendingRequest}
        undoLastAiEdit={undoLastAiEdit}
        aiInstruction={aiInstruction} aiEditing={aiEditing}
        activeDocument={activeDocument} generateAiEdit={generateAiEdit}
        preferences={preferences} setPreferences={setPreferences}
        showEnvValues={showEnvValues} setShowEnvValues={setShowEnvValues}
        terminalEnvText={terminalEnvText} setTerminalEnvText={setTerminalEnvText}
      />

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
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { const nodes = visibleTreeNodes.filter((node) => selectedPaths.has(node.path)); setTreeClipboard({ nodes: nodes.length ? nodes : [treeMenu.node], cut: false }); setTreeMenu(null); }}>复制{selectedPaths.size > 1 ? ` (${selectedPaths.size})` : ''}</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { const nodes = visibleTreeNodes.filter((node) => selectedPaths.has(node.path)); setTreeClipboard({ nodes: nodes.length ? nodes : [treeMenu.node], cut: true }); setTreeMenu(null); }}>剪切{selectedPaths.size > 1 ? ` (${selectedPaths.size})` : ''}</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={!treeClipboard} onClick={() => { void pasteTreeEntry(treeMenu.node); setTreeMenu(null); }}>粘贴</button>
            {treeMenu.node.type === 'file' && <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => void showGitDiff({ path: treeMenu.node.path, status: ' M' })}>与 HEAD 比较</button>}
            {treeMenu.node.type === 'file' && activeDocument && treeMenu.node.path !== activeDocument.path && <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={async () => {
              if (!workspace) return;
              const read = await window.electronAPI.workspace.readTextFile(workspace.path, treeMenu.node.path);
              if (read.success && read.data) setDiffView({ path: treeMenu.node.path, name: `${activeDocument.name} ↔ ${treeMenu.node.name}`, original: activeDocument.content, modified: read.data.content, language: languageIdFromName(treeMenu.node.path), source: 'external' });
              setTreeMenu(null);
            }}>与活动文件比较</button>}
            {treeMenu.node.type === 'file' && <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => void showFileTimeline(treeMenu.node)}>文件时间线</button>}
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { if (workspace) void window.electronAPI.workspace.revealEntry(workspace.path, treeMenu.node.path); setTreeMenu(null); }}>在文件管理器中显示</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { if (workspace) void navigator.clipboard.writeText(`${workspace.path}\\${treeMenu.node.path}`); setTreeMenu(null); }}>复制路径</button>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { void navigator.clipboard.writeText(treeMenu.node.path); setTreeMenu(null); }}>复制相对路径</button>
            <div className="my-1 border-t" />
            <button type="button" className="w-full px-3 py-1.5 text-left text-destructive hover:bg-accent" onClick={() => { void (selectedPaths.size > 1 ? deleteTreeSelection() : deleteSelected(treeMenu.node)); setTreeMenu(null); }}>移到回收站{selectedPaths.size > 1 ? ` (${selectedPaths.size})` : ''}</button>
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

      {diffView && <DiffViewPanel
        diffView={diffView}
        resolvedTheme={resolvedTheme}
        gitHunks={gitHunks}
        aiHunks={aiHunks}
        mergeHunks={mergeHunks}
        searchPreviews={searchPreviews}
        aiProposals={aiProposals}
        mergeBase={mergeBase}
        mergeResult={mergeResult}
        onMergeResultChange={setMergeResult}
        canFinishMerge={mergeResult !== null && !hasGitConflictMarkers(mergeResult)}
        onClose={() => void closeDiffView()}
        onStageGitHunk={stageGitHunk}
        onUnstageFile={unstageFile}
        gitStatusHasStaged={gitStatus.some((e) => e.path === diffView.path && e.status[0] !== ' ' && e.status[0] !== '?')}
        onResolveConflict={resolveGitConflict}
        onAcceptAi={acceptAiEdit}
        onAcceptAllAi={acceptAllAiEdits}
        onRejectAi={rejectAiEdit}
        onApplyAiHunk={applyAiHunk}
        onApplyMergeHunk={applyMergeHunk}
        onFinishMerge={finishMerge}
        onAcceptSearch={acceptSearchReplace}
        onRejectSearch={rejectSearchReplace}
      />}

      <SearchPanel
        searchPanel={searchPanel}
        setSearchPanel={setSearchPanel}
        runSearch={runSearch}
        replaceAllSearchResults={replaceAllSearchResults}
        openSearchResult={openSearchResult}
        replaceResults={replaceSearchResults}
        undoReplace={undoSearchReplace}
        canUndoReplace={replaceHistory.length > 0}
        previewReplace={previewSearchReplace}
        openSearchAsEditor={() => {
          if (searchPanel.results.length === 0) return;
          const content = searchPanel.results.map((r) => `${r.path}:${r.line}:${r.column}  ${r.preview}`).join('\n');
          const name = `搜索结果: ${searchPanel.query.slice(0, 40)}`;
          const path = `__search__/${Date.now()}`;
          setDocuments((prev) => [...prev, { path, name, content, savedContent: content, language: 'plaintext', encoding: 'utf8', lineEnding: 'LF', pinned: true, readOnly: false, standalone: false }]);
          setActivePath(path);
          setSearchPanel((p) => ({ ...p, open: false }));
          setStatus(`已打开搜索编辑器：${searchPanel.results.length} 条结果`);
        }}
      />

      <QuickOpenPanel
        quickOpen={quickOpen}
        setQuickOpen={setQuickOpen}
        quickOpenResults={quickOpenResults}
        openTreeFile={openTreeFile}
      />
      <DialogOverlay dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
};
