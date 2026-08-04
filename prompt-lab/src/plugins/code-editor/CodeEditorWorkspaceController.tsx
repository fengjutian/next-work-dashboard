import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import type {
  WorkspaceEncoding,
  WorkspaceGitStatus,
  WorkspaceGitCommit,
} from '@/types/electron';
import { decodeBase64Utf8, hasGitConflictMarkers, languageIdFromName } from './editor-utils';
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
import { useExplorerTree } from './useExplorerTree';
import { useExplorerMutations } from './useExplorerMutations';
import { useFileOpening } from './useFileOpening';
import { useExplorerNavigation } from './useExplorerNavigation';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WorkspaceExplorer } from './WorkspaceExplorer';
import { EditorDocumentHeader } from './EditorDocumentHeader';
import { EditorWorkspaceBody } from './EditorWorkspaceBody';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorTabMenu } from './EditorTabMenu';
import { requestEditorNavigation, subscribeEditorNavigation } from '@/services/editor-navigation';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
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
  const [knowledgeBacklinks, setKnowledgeBacklinks] = useState<Array<{ sourcePath?: string; sourceTitle?: string; line: number }>>([]);
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

  const {
    loadDirectory, hydrateExpandedTree, refreshWorkspaceTree,
    remapOpenPaths, revealWorkspacePath,
  } = useExplorerTree({
    workspace,
    expandedPaths,
    setExpandedPaths,
    setTree,
    setDocuments,
    setActivePath,
  });

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
    } else setSelectedPaths(new Set([node.path]));
    setSelectedNode(node);
  }, [selectedNode, visibleTreeNodes]);
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

  const {
    beginCreate, beginRename, commitTreeEdit, deleteSelected, deleteTreeSelection,
    pasteTreeEntry, moveTreeEntry,
  } = useExplorerMutations({
    workspace, documents, setDocuments, activePath, setActivePath,
    secondaryPath, setSecondaryPath, selectedNode, setSelectedNode,
    selectedPaths, setSelectedPaths, treeEdit, setTreeEdit, setTreeMenu,
    treeClipboard, setTreeClipboard,
    refreshWorkspaceTree, remapOpenPaths, appConfirm, setStatus,
  });
  const { showQuickOpen, openStandaloneFile, openTreeFile } = useFileOpening({
    workspace,
    documents,
    setDocuments,
    setActivePath,
    setQuickOpen,
    revealWorkspacePath,
    setStatus,
  });

  useEffect(() => subscribeEditorNavigation((request) => {
    void (async () => {
      const authorization = await window.electronAPI.workspace.reauthorize(request.rootPath);
      if (!authorization.success) { setStatus('知识文档工作区授权失败'); return; }
      if (workspace?.path !== request.rootPath) {
        const entries = await loadDirectory(request.rootPath);
        const name = request.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? request.rootPath;
        const id = `knowledge-${Date.now()}`;
        setWorkspace({ path: request.rootPath, name });
        setWorkspaceFolders((previous) => previous.some((folder) => folder.path === request.rootPath)
          ? previous
          : [...previous, { id, path: request.rootPath, name }]);
        setActiveFolderId(id);
        setTree(entries);
        setExpandedPaths(new Set());
      }
      const result = await window.electronAPI.workspace.readTextFile(request.rootPath, request.path);
      if (!result.success || !result.data) { setStatus(`打开知识文档失败：${displayError(result.error)}`); return; }
      const data = result.data;
      setDocuments((previous) => {
        const existing = previous.find((document) => document.path === request.path && !document.standalone);
        if (existing) return previous.map((document) => document === existing ? { ...document, pinned: true } : document);
        return [...previous, {
          path: request.path, name: request.path.split(/[\\/]/).at(-1) ?? request.path,
          content: data.content, savedContent: data.content, language: languageIdFromName(request.path),
          encoding: data.encoding, lineEnding: data.lineEnding, mixedLineEndings: data.mixedLineEndings,
          modifiedAt: data.modifiedAt, readOnly: data.readOnly, pinned: true,
        }];
      });
      pendingRevealRef.current = { path: request.path, line: Math.max(1, request.line ?? 1), column: Math.max(1, request.column ?? 1) };
      setActivePath(request.path);
      setStatus(`已打开知识文档 ${request.path}`);
    })();
  }), [loadDirectory, setStatus, workspace?.path]);

  useEffect(() => {
    if (!workspace || !activeDocument || !/\.mdx?$/i.test(activeDocument.path)) { setKnowledgeBacklinks([]); return; }
    activeKnowledgeWorkspace.setActive(workspace.path);
    void activeKnowledgeWorkspace.backlinks(activeDocument.path)
      .then(setKnowledgeBacklinks)
      .catch(() => setKnowledgeBacklinks([]));
  }, [activeDocument, workspace]);

  useEffect(() => {
    const providers = ['markdown', 'plaintext'].map((language) => monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['['],
      provideCompletionItems: (model, position) => {
        if (!activePath || !/\.mdx?$/i.test(activePath)) return { suggestions: [] };
        const prefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const match = prefix.match(/\[\[([^\]]*)$/);
        if (!match) return { suggestions: [] };
        const query = match[1].toLocaleLowerCase();
        const startColumn = position.column - match[1].length;
        return {
          suggestions: activeKnowledgeWorkspace.documents
            .filter((document) => document.path !== activePath)
            .filter((document) => !query || document.title.toLocaleLowerCase().includes(query) || document.path.toLocaleLowerCase().includes(query))
            .slice(0, 50)
            .map((document) => ({
              label: document.title,
              detail: document.path,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: `${document.title}]]`,
              range: new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column),
            })),
        };
      },
    }));
    return () => providers.forEach((provider) => provider.dispose());
  }, [activePath]);
  const { toggleDirectory, handleTreeKeyDown } = useExplorerNavigation({
    workspace,
    visibleTreeNodes,
    selectedNode,
    selectTreeNode,
    setTree,
    setExpandedPaths,
    loadDirectory,
    openTreeFile,
    beginRename,
    deleteTreeSelection,
    setStatus,
  });
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
      <WorkspaceToolbar
        workspaceOpen={Boolean(workspace)}
        activeDocument={activeDocument}
        hasDirtyDocuments={hasDirtyDocuments}
        autoSave={autoSave}
        bottomPanelOpen={bottomPanel.open}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onOpenWorkspace={(add) => { void openWorkspace(add); }}
        onOpenFile={() => { void openStandaloneFile(); }}
        onOpenSearch={() => setSearchPanel((previous) => ({ ...previous, open: true }))}
        onSemanticSearch={() => { void runSemanticSearch(); }}
        onEditorAction={(id, message) => { void runEditorAction(id, message); }}
        onFormat={() => { void formatActiveDocument(); }}
        onTogglePanel={() => setBottomPanel((previous) => ({ ...previous, open: !previous.open }))}
        onToggleAutoSave={() => setAutoSave((value) => !value)}
        onSave={() => { void saveActive(); }}
        onSaveAll={() => { void saveAll(); }}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarVisible && <WorkspaceExplorer
          width={sidebarWidth}
          workspace={workspace}
          folders={workspaceFolders}
          tree={tree}
          filter={explorerFilter}
          sort={explorerSort}
          activePath={activePath}
          selectedNode={selectedNode}
          selectedPaths={selectedPaths}
          treeEdit={treeEdit}
          decorations={treeDecorations}
          onKeyDown={handleTreeKeyDown}
          onFilterChange={setExplorerFilter}
          onToggleSort={() => setExplorerSort((value) => value === 'name' ? 'type' : 'name')}
          onCreate={beginCreate}
          onRename={() => beginRename()}
          onDelete={() => { void (selectedPaths.size > 1 ? deleteTreeSelection() : deleteSelected()); }}
          onQuickOpen={() => { void showQuickOpen(); }}
          onRefresh={() => { void refreshWorkspaceTree(); }}
          onCollapseAll={() => { setExpandedPaths(new Set()); setTree((previous) => previous.map((node) => ({ ...node, children: undefined }))); }}
          onSwitchFolder={(folder) => { void (async () => { if (folder.path === workspace?.path) return; setStatus(`切换到 ${folder.name}…`); const entries = await loadDirectory(folder.path); setWorkspace({ path: folder.path, name: folder.name }); setTree(entries); setExpandedPaths(new Set()); setActiveFolderId(folder.id); setStatus(`已切换至 ${folder.name}`); })(); }}
          onRemoveFolder={(folder) => { void (async () => { if (folder.path === workspace?.path) { const next = workspaceFolders.find((item) => item.path !== folder.path); if (next) { const entries = await loadDirectory(next.path); setWorkspace({ path: next.path, name: next.name }); setTree(entries); } else { setWorkspace(null); setTree([]); } } setWorkspaceFolders((previous) => previous.filter((item) => item.id !== folder.id)); })(); }}
          onOpen={openTreeFile}
          onToggle={toggleDirectory}
          onSelect={selectTreeNode}
          onEditChange={(value) => setTreeEdit((previous) => previous ? { ...previous, value } : previous)}
          onEditCommit={() => { void commitTreeEdit(); }}
          onEditCancel={() => setTreeEdit(null)}
          onContextMenu={(event, node) => { event.preventDefault(); if (!selectedPaths.has(node.path)) { setSelectedPaths(new Set([node.path])); setSelectedNode(node); } setTreeMenu({ x: event.clientX, y: event.clientY, node }); }}
          onMove={(source, target) => { void moveTreeEntry(source, target); }}
          onResize={setSidebarWidth}
        />}
        <main className="flex min-w-0 flex-1 flex-col">
          <EditorDocumentHeader
            documents={documents}
            activeDocument={activeDocument}
            activePath={activePath}
            workspaceOpen={Boolean(workspace)}
            onActivate={setActivePath}
            onPin={(path) => setDocuments((previous) => previous.map((document) => document.path === path ? { ...document, pinned: true } : document))}
            onClose={(path) => { void closeDocument(path); }}
            onTabMenu={(x, y, path) => setTabMenu({ x, y, path })}
            onMoveTab={moveTab}
            onReload={(document) => { void reloadExternalDocument(document); }}
            onCompare={(document) => { void compareExternalDocument(document); }}
            onForceSave={(document) => { void saveDocument(document, true); }}
          />
          {activeDocument && /\.mdx?$/i.test(activeDocument.path) && (
            <div className="flex min-h-8 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/20 px-3 text-[11px]">
              <span className="shrink-0 font-medium text-muted-foreground">反向链接 {knowledgeBacklinks.length}</span>
              {knowledgeBacklinks.length === 0 ? <span className="text-muted-foreground">暂无引用</span> : knowledgeBacklinks.map((link, index) => (
                <button
                  key={`${link.sourcePath}:${link.line}:${index}`}
                  className="shrink-0 rounded border px-2 py-1 hover:bg-accent"
                  disabled={!link.sourcePath}
                  onClick={() => link.sourcePath && requestEditorNavigation({ rootPath: workspace!.path, path: link.sourcePath, line: link.line, column: 1 })}
                >
                  {link.sourceTitle ?? link.sourcePath} · L{link.line}
                </button>
              ))}
            </div>
          )}
          <EditorWorkspaceBody
            activeDocument={activeDocument}
            secondaryDocument={secondaryDocument}
            editorPath={editorPath}
            dark={resolvedTheme === 'dark'}
            preferences={preferences}
            inlineEdit={inlineEdit}
            aiEditing={aiEditing}
            onInlineEditChange={(instruction) => setInlineEdit((previous) => ({ ...previous, instruction }))}
            onInlineEditCancel={() => setInlineEdit({ instruction: '', visible: false })}
            onInlineEditRun={() => { void runInlineEdit(); }}
            onMount={handleMount}
            onDocumentChange={(path, content) => setDocuments((previous) => previous.map((document) => document.path === path ? { ...document, content, pinned: true } : document))}
            onCloseSecondary={() => setSecondaryPath(null)}
            onOpenWorkspace={() => { void openWorkspace(false); }}
            onOpenFile={() => { void openStandaloneFile(); }}
          />

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

      <EditorStatusBar
        workspaceName={workspace?.name}
        status={status}
        document={activeDocument}
        line={position.line}
        column={position.column}
        tabSize={preferences.tabSize}
        onOpenSettings={() => setBottomPanel({ open: true, tab: 'settings', height: 220 })}
      />

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

      <EditorTabMenu
        menu={tabMenu}
        documents={documents}
        onCloseMenu={() => setTabMenu(null)}
        onTogglePin={(path) => setDocuments((previous) => previous.map((document) => document.path === path ? { ...document, pinned: document.pinned === false } : document))}
        onOpenSecondary={setSecondaryPath}
        onClosePaths={(paths) => { void closeDocumentSet(paths); }}
      />
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
