import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
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
import type { FilePickResult, WorkspaceEntry, WorkspaceSearchResult } from '@/types/electron';
import { decodeBase64Utf8, languageFromName, languageIdFromName } from './editor-utils';

export { decodeBase64Utf8, languageFromName, languageIdFromName } from './editor-utils';

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

interface OpenDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
  standalone?: boolean;
  encoding: 'utf8' | 'utf8bom';
  lineEnding: 'LF' | 'CRLF';
  modifiedAt?: number;
  externalChanged?: boolean;
  readOnly?: boolean;
  pinned?: boolean;
  missing?: boolean;
}

interface TreeNode extends WorkspaceEntry {
  children?: TreeNode[];
  loading?: boolean;
}

interface TreeEditState {
  mode: 'create-file' | 'create-directory' | 'rename';
  value: string;
  target?: TreeNode;
}

const errorMessages: Record<string, string> = {
  ACCESS_DENIED: '路径不在当前工作区内',
  BINARY_FILE: '二进制文件无法在代码编辑器中打开',
  FILE_TOO_LARGE: '文件超过 20MB，请使用其他工具打开',
  FILE_READ_ONLY: '文件为只读，无法保存',
  FILE_MODIFIED_EXTERNALLY: '文件已在外部修改，请重新加载或确认覆盖',
  NOT_A_FILE: '目标不是文件',
  NOT_A_DIRECTORY: '目标不是目录',
  ALREADY_EXISTS: '同名文件或文件夹已经存在',
  ENOENT: '文件或文件夹不存在',
};

function displayError(error?: string): string {
  return errorMessages[error ?? ''] ?? error ?? '操作失败';
}

const FileTreeRow: React.FC<{
  node: TreeNode;
  depth: number;
  activePath: string | null;
  selectedPath: string | null;
  onOpen: (node: TreeNode) => void;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
  editing?: TreeEditState | null;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onMove: (source: TreeNode, target: TreeNode) => void;
}> = ({
  node, depth, activePath, selectedPath, onOpen, onToggle, onSelect,
  editing, onEditChange, onEditCommit, onEditCancel, onContextMenu, onMove,
}) => {
  const isDirectory = node.type === 'directory';
  const expanded = node.children !== undefined;
  return (
    <>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-1.5 truncate pr-2 text-left text-xs hover:bg-accent/60 ${
          activePath === node.path || selectedPath === node.path
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          onSelect(node);
          if (isDirectory) onToggle(node);
          else onOpen(node);
        }}
        title={node.path}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-nwd-tree-path', node.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (isDirectory) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!isDirectory) return;
          event.preventDefault();
          const sourcePath = event.dataTransfer.getData('application/x-nwd-tree-path');
          if (sourcePath) onMove({ name: sourcePath.split(/[\\/]/).pop() ?? sourcePath, path: sourcePath, type: 'file' }, node);
        }}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        {isDirectory ? (
          <>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        {editing?.mode === 'rename' && editing.target?.path === node.path ? (
          <input
            autoFocus
            value={editing.value}
            onChange={(event) => onEditChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') onEditCommit();
              if (event.key === 'Escape') onEditCancel();
            }}
            onBlur={onEditCommit}
            className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {node.loading && <RefreshCw className="ml-auto h-3 w-3 animate-spin" />}
      </button>
      {expanded && node.children?.map((child) => (
        <FileTreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          selectedPath={selectedPath}
          onOpen={onOpen}
          onToggle={onToggle}
          onSelect={onSelect}
          editing={editing}
          onEditChange={onEditChange}
          onEditCommit={onEditCommit}
          onEditCancel={onEditCancel}
          onContextMenu={onContextMenu}
          onMove={onMove}
        />
      ))}
    </>
  );
};

function updateTreeNode(nodes: TreeNode[], path: string, update: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return update(node);
    if (node.children) return { ...node, children: updateTreeNode(node.children, path, update) };
    return node;
  });
}

export const CodeEditorPanel: React.FC = () => {
  const { theme } = useStore();
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const [workspace, setWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [treeEdit, setTreeEdit] = useState<TreeEditState | null>(null);
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [treeClipboard, setTreeClipboard] = useState<{ node: TreeNode; cut: boolean } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [autoSave, setAutoSave] = useState(false);
  const [status, setStatus] = useState('就绪');
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; query: string; files: TreeNode[] }>({
    open: false, query: '', files: [],
  });
  const [searchPanel, setSearchPanel] = useState<{
    open: boolean;
    query: string;
    caseSensitive: boolean;
    loading: boolean;
    results: WorkspaceSearchResult[];
  }>({ open: false, query: '', caseSensitive: false, loading: false, results: [] });
  const restoringRef = useRef(true);
  const documentsRef = useRef<OpenDocument[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const recentlySavedRef = useRef(new Map<string, number>());
  const viewStatesRef = useRef<Record<string, monaco.editor.ICodeEditorViewState | null>>({});

  const activeDocument = documents.find((document) => document.path === activePath) ?? null;
  const hasDirtyDocuments = documents.some((document) => document.content !== document.savedContent);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const loadDirectory = useCallback(async (rootPath: string, relativePath = '') => {
    const result = await window.electronAPI.workspace.listDirectory(rootPath, relativePath);
    if (!result.success) throw new Error(displayError(result.error));
    return (result.data ?? []) as TreeNode[];
  }, []);

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
    if (activePath && affectedPaths.has(activePath)) setActivePath(remaining[0]?.path ?? null);
    setSelectedNode(null);
    await refreshWorkspaceTree();
    setStatus(`已将 ${node.name} 移到回收站`);
  }, [activePath, documents, refreshWorkspaceTree, selectedNode, workspace]);

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

  const openTreeFile = useCallback(async (node: TreeNode) => {
    if (!workspace) return;
    if (documents.some((document) => document.path === node.path)) {
      setActivePath(node.path);
      void revealWorkspacePath(node.path);
      return;
    }
    setStatus(`正在打开 ${node.name}…`);
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, node.path);
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
        modifiedAt: result.data.modifiedAt,
        readOnly: result.data.readOnly,
        pinned: false,
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
          savedContent: item.content,
          modifiedAt: 'data' in result ? result.data?.modifiedAt : item.modifiedAt,
          externalChanged: false,
        }
        : item
    )));
    setStatus(`已保存 ${document.name}`);
    return true;
  }, [workspace]);

  const saveActive = useCallback(async () => {
    if (activeDocument) await saveDocument(activeDocument);
  }, [activeDocument, saveDocument]);

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
    if (activePath === path) {
      setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
    }
  }, [activePath, documents]);

  const closeDocumentSet = useCallback((paths: string[]) => {
    const pathSet = new Set(paths);
    const dirty = documents.filter((document) => (
      pathSet.has(document.path) && document.content !== document.savedContent
    ));
    if (dirty.length > 0 && !window.confirm(`${dirty.length} 个文件尚未保存，仍要关闭吗？`)) return;
    const remaining = documents.filter((document) => !pathSet.has(document.path));
    setDocuments(remaining);
    if (activePath && pathSet.has(activePath)) setActivePath(remaining[0]?.path ?? null);
  }, [activePath, documents]);

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

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column });
    });
    editor.focus();
  }, []);

  const runSearch = useCallback(async () => {
    if (!workspace || !searchPanel.query.trim()) return;
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    const result = await window.electronAPI.workspace.search(
      workspace.path,
      searchPanel.query.trim(),
      { caseSensitive: searchPanel.caseSensitive },
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
  }, [searchPanel.caseSensitive, searchPanel.query, workspace]);

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
        modifiedAt: result.data!.modifiedAt,
        externalChanged: false,
        readOnly: result.data!.readOnly,
      }
      : item));
    setStatus(`已重新加载 ${document.name}`);
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
          <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar-bg">
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
              <button type="button" className="rounded p-1 hover:bg-accent" title="删除选中项" onClick={() => void deleteSelected()} disabled={!selectedNode}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-1 hover:bg-accent" title="快速打开 (Ctrl+P)" onClick={() => void showQuickOpen()} disabled={!workspace}>
                <Search className="h-3.5 w-3.5" />
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
                    selectedPath={selectedNode?.path ?? null}
                    onOpen={openTreeFile}
                    onToggle={toggleDirectory}
                    onSelect={setSelectedNode}
                    editing={treeEdit}
                    onEditChange={(value) => setTreeEdit((previous) => previous ? { ...previous, value } : previous)}
                    onEditCommit={() => void commitTreeEdit()}
                    onEditCancel={() => setTreeEdit(null)}
                    onContextMenu={(event, current) => {
                      event.preventDefault();
                      setSelectedNode(current);
                      setTreeMenu({ x: event.clientX, y: event.clientY, node: current });
                    }}
                    onMove={(source, target) => void moveTreeEntry(source, target)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-5 text-xs leading-5 text-muted-foreground">
                尚未打开文件夹。打开工作区后可浏览和编辑其中的文件。
              </div>
            )}
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

          {activeDocument ? (
            <div className="min-h-0 flex-1">
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
                  fontFamily: "'Cascadia Code', 'SF Mono', Consolas, monospace",
                  fontSize: 13,
                  lineHeight: 20,
                  minimap: { enabled: true },
                  padding: { top: 8 },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  tabSize: 2,
                  readOnly: activeDocument.readOnly,
                }}
              />
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
        </main>
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-primary px-3 text-[11px] text-primary-foreground">
        <span className="max-w-48 truncate">{workspace?.name ?? '无工作区'}</span>
        <span className="flex-1 truncate opacity-90">{status}</span>
        {activeDocument && (
          <>
            <span>Ln {position.line}, Col {position.column}</span>
            <span>Spaces: 2</span>
            <span>{activeDocument.encoding === 'utf8bom' ? 'UTF-8 with BOM' : 'UTF-8'}</span>
            <span>{activeDocument.lineEnding}</span>
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
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocument(document.path); setTabMenu(null); }}>关闭</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocumentSet(documents.filter((item) => item.path !== document.path).map((item) => item.path)); setTabMenu(null); }}>关闭其他</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={index === documents.length - 1} onClick={() => { closeDocumentSet(documents.slice(index + 1).map((item) => item.path)); setTabMenu(null); }}>关闭右侧</button>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { closeDocumentSet(documents.filter((item) => item.content === item.savedContent).map((item) => item.path)); setTabMenu(null); }}>关闭已保存</button>
            </div>
          </div>
        );
      })()}

      {searchPanel.open && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-16" onMouseDown={() => setSearchPanel((previous) => ({ ...previous, open: false }))}>
          <div className="w-[min(720px,85vw)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={searchPanel.query}
                onChange={(event) => setSearchPanel((previous) => ({ ...previous, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch();
                }}
                placeholder="在工作区文件内容中搜索"
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                className={`rounded px-1.5 py-1 font-mono text-xs ${searchPanel.caseSensitive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
                onClick={() => setSearchPanel((previous) => ({ ...previous, caseSensitive: !previous.caseSensitive }))}
                title="区分大小写"
              >
                Aa
              </button>
              <Button size="sm" className="h-7 px-3 text-xs" disabled={!searchPanel.query.trim() || searchPanel.loading} onClick={() => void runSearch()}>
                {searchPanel.loading ? '搜索中…' : '搜索'}
              </Button>
              <kbd className="text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <div className="max-h-[420px] overflow-auto py-1">
              {searchPanel.results.map((result, index) => (
                <button
                  type="button"
                  key={`${result.path}:${result.line}:${result.column}:${index}`}
                  className="flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                  onClick={() => void openSearchResult(result)}
                >
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="w-52 shrink-0 truncate font-medium" title={result.path}>
                    {result.path}:{result.line}:{result.column}
                  </span>
                  <span className="truncate font-mono text-muted-foreground">{result.preview}</span>
                </button>
              ))}
              {!searchPanel.loading && searchPanel.query && searchPanel.results.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">没有搜索结果</div>
              )}
            </div>
          </div>
        </div>
      )}

      {quickOpen.open && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-16" onMouseDown={() => setQuickOpen((previous) => ({ ...previous, open: false }))}>
          <div className="w-[min(640px,80vw)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={quickOpen.query}
                onChange={(event) => setQuickOpen((previous) => ({ ...previous, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && quickOpenResults[0]) {
                    void openTreeFile(quickOpenResults[0]);
                    setQuickOpen((previous) => ({ ...previous, open: false }));
                  }
                }}
                placeholder="输入文件名快速打开"
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
              <kbd className="text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <div className="max-h-80 overflow-auto py-1">
              {quickOpenResults.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    void openTreeFile(file);
                    setQuickOpen((previous) => ({ ...previous, open: false }));
                  }}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{file.name}</span>
                  <span className="truncate text-muted-foreground">{file.path}</span>
                </button>
              ))}
              {quickOpenResults.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的文件</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
