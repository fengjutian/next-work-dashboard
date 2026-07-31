import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  PanelLeft,
  RefreshCw,
  X,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import type { FilePickResult, WorkspaceEntry } from '@/types/electron';

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

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.some((byte) => byte === 0)) {
    throw new Error('检测到二进制内容，代码编辑器仅支持文本文件');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function languageIdFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const languages: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', html: 'html', css: 'css', scss: 'scss', less: 'less',
    vue: 'html', svelte: 'html', json: 'json', jsonc: 'json',
    md: 'markdown', sql: 'sql', sh: 'shell', ps1: 'powershell',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', php: 'php', rb: 'ruby',
    swift: 'swift', toml: 'ini', env: 'ini',
  };
  return languages[extension] ?? 'plaintext';
}

export function languageFromName(name: string): string {
  const id = languageIdFromName(name);
  const labels: Record<string, string> = {
    plaintext: 'Plain Text',
    javascript: name.toLowerCase().endsWith('x') ? 'JavaScript React' : 'JavaScript',
    typescript: name.toLowerCase().endsWith('x') ? 'TypeScript React' : 'TypeScript',
    csharp: 'C#',
    cpp: 'C++',
    powershell: 'PowerShell',
  };
  return labels[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

interface OpenDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
  standalone?: boolean;
}

interface TreeNode extends WorkspaceEntry {
  children?: TreeNode[];
  loading?: boolean;
}

const errorMessages: Record<string, string> = {
  ACCESS_DENIED: '路径不在当前工作区内',
  BINARY_FILE: '二进制文件无法在代码编辑器中打开',
  FILE_TOO_LARGE: '文件超过 5MB，请使用其他工具打开',
  NOT_A_FILE: '目标不是文件',
  NOT_A_DIRECTORY: '目标不是目录',
};

function displayError(error?: string): string {
  return errorMessages[error ?? ''] ?? error ?? '操作失败';
}

const FileTreeRow: React.FC<{
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onOpen: (node: TreeNode) => void;
  onToggle: (node: TreeNode) => void;
}> = ({ node, depth, activePath, onOpen, onToggle }) => {
  const isDirectory = node.type === 'directory';
  const expanded = node.children !== undefined;
  return (
    <>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-1.5 truncate pr-2 text-left text-xs hover:bg-accent/60 ${
          activePath === node.path ? 'bg-accent text-accent-foreground' : 'text-foreground'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDirectory ? onToggle(node) : onOpen(node))}
        title={node.path}
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
        <span className="truncate">{node.name}</span>
        {node.loading && <RefreshCw className="ml-auto h-3 w-3 animate-spin" />}
      </button>
      {expanded && node.children?.map((child) => (
        <FileTreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          onOpen={onOpen}
          onToggle={onToggle}
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
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [status, setStatus] = useState('就绪');
  const [position, setPosition] = useState({ line: 1, column: 1 });

  const activeDocument = documents.find((document) => document.path === activePath) ?? null;
  const hasDirtyDocuments = documents.some((document) => document.content !== document.savedContent);

  const loadDirectory = useCallback(async (rootPath: string, relativePath = '') => {
    const result = await window.electronAPI.workspace.listDirectory(rootPath, relativePath);
    if (!result.success) throw new Error(displayError(result.error));
    return (result.data ?? []) as TreeNode[];
  }, []);

  const openWorkspace = useCallback(async () => {
    if (hasDirtyDocuments && !window.confirm('当前工作区有未保存的修改，仍要打开其他文件夹吗？')) return;
    const folder = await window.electronAPI.workspace.openFolder();
    if (!folder) return;
    try {
      setStatus('正在读取工作区…');
      const entries = await loadDirectory(folder.path);
      setWorkspace(folder);
      setTree(entries);
      setDocuments([]);
      setActivePath(null);
      setStatus(`已打开 ${folder.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '工作区打开失败');
    }
  }, [hasDirtyDocuments, loadDirectory]);

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
      return;
    }
    setStatus(`正在打开 ${node.name}…`);
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, node.path);
    if (!result.success || !result.data) {
      setStatus(displayError(result.error));
      return;
    }
    setDocuments((previous) => [...previous, {
      path: node.path,
      name: node.name,
      content: result.data!.content,
      savedContent: result.data!.content,
      language: languageIdFromName(node.name),
    }]);
    setActivePath(node.path);
    setStatus(`已打开 ${node.name}`);
  }, [documents, workspace]);

  const toggleDirectory = useCallback(async (node: TreeNode) => {
    if (!workspace) return;
    if (node.children !== undefined) {
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

  const saveDocument = useCallback(async (document: OpenDocument) => {
    setStatus(`正在保存 ${document.name}…`);
    const result = document.standalone
      ? await window.electronAPI.writeTextFile(document.path, document.content)
      : workspace
        ? await window.electronAPI.workspace.writeTextFile(workspace.path, document.path, document.content)
        : { success: false, error: 'NO_WORKSPACE' };
    if (!result.success) {
      setStatus(`保存失败：${displayError(result.error)}`);
      return false;
    }
    setDocuments((previous) => previous.map((item) => (
      item.path === document.path ? { ...item, savedContent: item.content } : item
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

  const handleMount: OnMount = useCallback((editor) => {
    editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column });
    });
    editor.focus();
  }, []);

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePath, closeDocument, openStandaloneFile, saveActive, saveAll]);

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
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
        <div className="flex-1" />
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
            <div className="flex h-9 items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Explorer
            </div>
            {workspace ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex h-7 items-center gap-1 px-2 text-xs font-semibold">
                  <ChevronDown className="h-3 w-3" />
                  <span className="truncate uppercase">{workspace.name}</span>
                </div>
                {tree.map((node) => (
                  <FileTreeRow key={node.path} node={node} depth={0} activePath={activePath} onOpen={openTreeFile} onToggle={toggleDirectory} />
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
                    title={document.path}
                  >
                    <Code className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{document.name}</span>
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
                      ? { ...document, content: value ?? '' }
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
            <span>UTF-8</span>
            <span>{languageFromName(activeDocument.name)}</span>
          </>
        )}
      </footer>
    </div>
  );
};
