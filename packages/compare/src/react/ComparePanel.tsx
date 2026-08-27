import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useCompareAdapter } from './context';
import { createDiffClient } from './diff-worker-client';
import { Button } from './Button';
import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Copy, Download, FileDiff, FileText, Rows3, Save, Upload } from 'lucide-react';
import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison, type TextDiffHunk } from '../core/text-diff';
import type { FilePickResult, WorkspaceEncoding, SaveFileOptions } from '../core/types';
import { DIFF_WORKER_THRESHOLD, useTextDiffHunks } from './useTextDiffHunks';
import { applyUnifiedPatch, parseUnifiedPatch, type UnifiedPatch } from '../core/unified-patch';
import {
  applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree,
  formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison,
  formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeParagraphs,
  type CompareMode, type JsonPatchOperation,
} from '../core/comparison-modes';
import { UnifiedDiffView } from './UnifiedDiffView';

interface CompareDocument {
  label: string;
  content: string;
  savedContent?: string;
  path?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  modifiedAt?: number;
  readOnly?: boolean;
}

interface SaveConflict {
  side: 'left' | 'right';
  current: {
    content: string;
    encoding: WorkspaceEncoding;
    lineEnding: 'LF' | 'CRLF';
    mixedLineEndings: boolean;
    modifiedAt: number;
  };
}

interface PatchSession {
  name: string;
  patch: UnifiedPatch;
  reverse: boolean;
}


interface CompareDocument {
  label: string;
  content: string;
  savedContent?: string;
  path?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  modifiedAt?: number;
  readOnly?: boolean;
}

interface SaveConflict {
  side: 'left' | 'right';
  current: {
    content: string;
    encoding: WorkspaceEncoding;
    lineEnding: 'LF' | 'CRLF';
    mixedLineEndings: boolean;
    modifiedAt: number;
  };
}

interface PatchSession {
  name: string;
  patch: UnifiedPatch;
  reverse: boolean;
}

const sampleLeft = `function greet(name: string) {\n  return 'Hello, ' + name;\n}\n`;
const sampleRight = `function greet(name: string) {\n  return \`Hello, \${name}!\`;\n}\n`;

interface ComparePreferences {
  mode: CompareMode;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreBlankLines: boolean;
  hideUnchanged: boolean;
  normalizeWidth: boolean;
  ignorePunctuation: boolean;
  jsonArrayKey: string;
  jsonOnlyChanges: boolean;
  envRedactSecrets: boolean;
}

const defaultPreferences: ComparePreferences = {
  mode: 'plain',
  sideBySide: true,
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
  hideUnchanged: true,
  normalizeWidth: true,
  ignorePunctuation: false,
  jsonArrayKey: '',
  jsonOnlyChanges: false,
  envRedactSecrets: true,
};

function readPreferences(): ComparePreferences {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem('compare.preferences.v1') ?? '{}') };
  } catch {
    return defaultPreferences;
  }
}

export const ComparePanel: React.FC = () => {
  const { api, store, monaco, worker, events } = useCompareAdapter();
  // Lazily initialise Monaco once on first render. Idempotent.
  monaco.configureMonaco();
  const theme = store.theme;
  const activeActivity = store.activeActivity;
  const diffClient = useMemo(() => createDiffClient(worker), [worker]);
  const [left, setLeft] = useState<CompareDocument>({ label: '原始文本.ts', content: sampleLeft });
  const [right, setRight] = useState<CompareDocument>({ label: '修改后.ts', content: sampleRight });
  const [preferences, setPreferences] = useState(readPreferences);
  const [activeChange, setActiveChange] = useState(-1);
  const [status, setStatus] = useState('可直接粘贴文本，或从文件载入');
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [patchSession, setPatchSession] = useState<PatchSession | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const editorListenersRef = useRef<monaco.IDisposable[]>([]);
  const unifiedViewRef = useRef<HTMLDivElement | null>(null);
  const structuredComparison = useMemo(() => {
    try {
      if (preferences.mode === 'chinese-word') {
        const options = { normalizeWidth: preferences.normalizeWidth, ignorePunctuation: preferences.ignorePunctuation };
        return { left: normalizeChineseLines(left.content, options), right: normalizeChineseLines(right.content, options), jsonChanges: [] };
      }
      if (preferences.mode === 'paragraph') return { left: normalizeParagraphs(left.content), right: normalizeParagraphs(right.content), jsonChanges: [] };
      if (preferences.mode === 'csv') return { left: formatCsvForComparison(left.content), right: formatCsvForComparison(right.content), jsonChanges: [] };
      if (preferences.mode === 'markdown') return { left: formatMarkdownForComparison(left.content), right: formatMarkdownForComparison(right.content), jsonChanges: [] };
      if (preferences.mode === 'env') return { left: formatEnvForComparison(left.content, preferences.envRedactSecrets), right: formatEnvForComparison(right.content, preferences.envRedactSecrets), jsonChanges: [] };
      if (preferences.mode === 'yaml') return { left: formatYamlForComparison(left.content, preferences.jsonArrayKey || undefined), right: formatYamlForComparison(right.content, preferences.jsonArrayKey || undefined), jsonChanges: [] };
      if (preferences.mode === 'xml') return { left: formatXmlForComparison(left.content), right: formatXmlForComparison(right.content), jsonChanges: [] };
      if (preferences.mode === 'json') {
        const before = canonicalizeJson(JSON.parse(left.content) as unknown, preferences.jsonArrayKey || undefined);
        const after = canonicalizeJson(JSON.parse(right.content) as unknown, preferences.jsonArrayKey || undefined);
        const jsonChanges = diffJsonTree(before, after);
        return {
          left: preferences.jsonOnlyChanges ? changesOnlyText(jsonChanges, 'before') : formatJsonForComparison(left.content, { arrayKey: preferences.jsonArrayKey || undefined }),
          right: preferences.jsonOnlyChanges ? changesOnlyText(jsonChanges, 'after') : formatJsonForComparison(right.content, { arrayKey: preferences.jsonArrayKey || undefined }),
          jsonChanges,
        };
      }
      return { left: left.content, right: right.content, jsonChanges: [] };
    } catch (error) {
      return { left: left.content, right: right.content, jsonChanges: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [left.content, preferences, right.content]);
  const displayLeft = useMemo(() => prepareTextForComparison(structuredComparison.left, preferences), [preferences, structuredComparison.left]);
  const displayRight = useMemo(() => prepareTextForComparison(structuredComparison.right, preferences), [preferences, structuredComparison.right]);
  const { hunks, computing: diffComputing, error: diffError, worker: usingWorker } = useTextDiffHunks(displayLeft, displayRight);
  const filtered = preferences.ignoreCase || preferences.ignoreBlankLines || preferences.mode !== 'plain';
  const structuredLanguages: Partial<Record<CompareMode, string>> = {
    json: 'json', yaml: 'yaml', xml: 'xml', csv: 'plaintext', markdown: 'markdown', env: 'ini',
  };
  const language = structuredLanguages[preferences.mode] ?? monaco.languageIdFromName(right.label || left.label);
  const dark = theme === 'dark' || (theme === 'system' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    localStorage.setItem('compare.preferences.v1', JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const applyComparison = (detail?: { left?: CompareDocument; right?: CompareDocument }) => {
      if (!detail?.left || !detail.right) return;
      setLeft({ ...detail.left, readOnly: true });
      setRight({ ...detail.right, readOnly: true });
      setPreferences((current) => ({ ...current, mode: 'markdown' }));
      setActiveChange(-1);
      setStatus(`正在比较 ${detail.left.label} 与 ${detail.right.label}`);
    };
    const openComparison = (detail: { left?: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; size?: number }; right?: { name: string; path: string; text?: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; modifiedAt?: number; readOnly?: boolean; size?: number } }) => {
      if (!detail.left || !detail.right) return;
      applyComparison({
        left: { ...documentFromFile(detail.left), readOnly: true },
        right: { ...documentFromFile(detail.right), readOnly: true },
      });
      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }
    };
    try {
      const pending = sessionStorage.getItem('compare.pending.v1');
      if (pending) {
        applyComparison(JSON.parse(pending) as { left?: CompareDocument; right?: CompareDocument });
        try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }
      }
    } catch {
      try { sessionStorage.removeItem('compare.pending.v1'); } catch { /* ignore */ }
    }
    const unsubscribe = events.onOpenContent(openComparison);
    return unsubscribe;
  }, [events]);

  const documentFromFile = (file: {
    name: string;
    path: string;
    text?: string;
    content?: string;
    encoding?: WorkspaceEncoding;
    lineEnding?: 'LF' | 'CRLF';
    modifiedAt?: number;
    readOnly?: boolean;
  }): CompareDocument => ({
    label: file.name,
    content: file.text ?? monaco.decodeBase64Utf8(file.content ?? ''),
    savedContent: file.text ?? monaco.decodeBase64Utf8(file.content ?? ''),
    path: file.path,
    encoding: file.encoding ?? 'utf8',
    lineEnding: file.lineEnding ?? 'LF',
    modifiedAt: file.modifiedAt,
    readOnly: file.readOnly,
  });

  const openFile = async (side: 'left' | 'right') => {
    const result = await api.pickFile();
    const file = Array.isArray(result) ? result[0] : result;
    if (!file) return;
    const size = file.size ?? (file.text?.length ?? file.content?.length ?? 0);
    if (size > 20 * 1024 * 1024) {
      setStatus('文件超过 20MB，已拒绝载入');
      return;
    }
    try {
      const document = documentFromFile(file);
      if (side === 'left') setLeft(document); else setRight(document);
      setStatus(`已载入 ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法读取该文件');
    }
  };

  const openTwoFiles = async () => {
    const result = await api.pickFile({ multiple: true });
    const files = Array.isArray(result) ? result : result ? [result] : [];
    if (files.length !== 2) {
      setStatus('请选择两个文本文件');
      return;
    }
    if (files.some((file) => (file.size ?? (file.text?.length ?? file.content?.length ?? 0)) > 20 * 1024 * 1024)) {
      setStatus('文件超过 20MB，已拒绝载入');
      return;
    }
    try {
      setLeft(documentFromFile(files[0]));
      setRight(documentFromFile(files[1]));
      setActiveChange(-1);
      setStatus(`已直接比较 ${files[0].name} 与 ${files[1].name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法读取选择的文件');
    }
  };

  const saveDocument = async (side: 'left' | 'right', saveAs = false, force = false) => {
    const document = side === 'left' ? left : right;
    if (document.readOnly && !saveAs) {
      setStatus(`${document.label} 为只读文件，请使用另存为`);
      return;
    }
    const options: SaveFileOptions = { encoding: document.encoding ?? 'utf8', lineEnding: document.lineEnding ?? 'LF' };
    let result: { success: boolean; path?: string; error?: string; modifiedAt?: number; current?: SaveConflict['current'] };
    if (document.path && !saveAs) {
      result = await api.writeTextFile(document.path, document.content, { ...options, expectedModifiedAt: document.modifiedAt, force });
    } else {
      const saved = await api.saveFile(document.content, document.label, options);
      result = { success: saved.success, path: saved.path, error: saved.error };
    }
    if (!result.success || !result.path) {
      const messages: Record<string, string> = {
        FILE_MODIFIED_EXTERNALLY: '文件已被外部修改，请重新载入或另存为',
        FILE_READ_ONLY: '文件为只读，请使用另存为',
        ACCESS_DENIED: '文件未由当前会话授权，请重新载入',
      };
      if (result.error === 'FILE_MODIFIED_EXTERNALLY' && result.current) {
        setSaveConflict({ side, current: result.current });
      }
      setStatus(messages[result.error ?? ''] ?? result.error ?? '保存已取消');
      return;
    }
    const next = { ...document, path: result.path, label: result.path.split(/[\\/]/).pop() ?? document.label, modifiedAt: result.modifiedAt, savedContent: document.content, readOnly: false };
    if (side === 'left') setLeft(next); else setRight(next);
    setSaveConflict(null);
    setStatus(`已保存 ${next.label}`);
  };

  const loadExternalVersion = () => {
    if (!saveConflict) return;
    const document = saveConflict.side === 'left' ? left : right;
    const next: CompareDocument = {
      ...document,
      content: saveConflict.current.content,
      savedContent: saveConflict.current.content,
      encoding: saveConflict.current.encoding,
      lineEnding: saveConflict.current.lineEnding,
      modifiedAt: saveConflict.current.modifiedAt,
    };
    if (saveConflict.side === 'left') setLeft(next); else setRight(next);
    setSaveConflict(null);
    setActiveChange(-1);
    setStatus(`已载入磁盘上的 ${document.label}`);
  };

  const navigate = (direction: 1 | -1) => {
    if (!preferences.sideBySide) {
      if (hunks.length === 0) {
        setStatus('两侧内容没有差异');
        return;
      }
      const next = (activeChange + direction + hunks.length) % hunks.length;
      unifiedViewRef.current?.querySelector<HTMLElement>(`[data-hunk-index="${next}"]`)?.scrollIntoView({ block: 'center' });
      setActiveChange(next);
      setStatus(`差异 ${next + 1}/${hunks.length}`);
      return;
    }
    const changes = editorRef.current?.getLineChanges() ?? [];
    if (changes.length === 0) {
      setStatus('两侧内容没有差异');
      return;
    }
    const next = (activeChange + direction + changes.length) % changes.length;
    const change = changes[next];
    const line = change.modifiedStartLineNumber || change.originalStartLineNumber;
    editorRef.current?.getModifiedEditor().revealLineInCenter(line);
    editorRef.current?.getModifiedEditor().setPosition({ lineNumber: line, column: 1 });
    setActiveChange(next);
    setStatus(`差异 ${next + 1}/${changes.length}`);
  };

  const copyPatch = async () => {
    setStatus('正在生成 Unified Diff…');
    let patch: string;
    try {
      patch = left.content.length + right.content.length >= DIFF_WORKER_THRESHOLD
        ? await diffClient.createUnifiedDiffAsync(left.content, right.content, left.label, right.label)
        : createUnifiedDiff(left.content, right.content, left.label, right.label);
    } catch (error) {
      setStatus(error instanceof Error && error.message === 'DIFF_TIMEOUT' ? 'Unified Diff 生成超时' : 'Unified Diff 生成失败');
      return;
    }
    if (!patch) {
      setStatus('两侧内容没有差异');
      return;
    }
    try {
      await navigator.clipboard.writeText(patch);
      setStatus('统一 diff 已复制到剪贴板');
    } catch {
      setStatus('复制失败，请检查剪贴板权限');
    }
  };

  const exportPatch = async () => {
    setStatus('正在生成 Patch 文件…');
    try {
      const patch = left.content.length + right.content.length >= DIFF_WORKER_THRESHOLD
        ? await diffClient.createUnifiedDiffAsync(left.content, right.content, left.label, right.label)
        : createUnifiedDiff(left.content, right.content, left.label, right.label);
      if (!patch) {
        setStatus('两侧内容没有差异');
        return;
      }
      const defaultName = `${right.label.replace(/\.[^.]+$/, '') || 'comparison'}.patch`;
      const result = await api.saveFile(patch, defaultName, { encoding: 'utf8', lineEnding: 'LF' });
      setStatus(result.success ? `已导出 ${result.path?.split(/[\\/]/).pop() ?? defaultName}` : result.error ?? '导出已取消');
    } catch (error) {
      setStatus(error instanceof Error && error.message === 'DIFF_TIMEOUT' ? 'Patch 生成超时' : 'Patch 导出失败');
    }
  };

  const importPatch = async () => {
    const result = await api.pickFile({ accept: '.patch,.diff' });
    const file = Array.isArray(result) ? result[0] : result;
    if (!file) return;
    try {
      const patch = parseUnifiedPatch(file.text ?? monaco.decodeBase64Utf8(file.content ?? ''));
      setPatchSession({ name: file.name, patch, reverse: false });
      setStatus(`已解析 ${file.name}：${patch.hunks.length} 个变更块`);
    } catch (error) {
      setPatchSession(null);
      setStatus(`Patch 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const previewPatch = (sourceSide: 'left' | 'right') => {
    if (!patchSession) return;
    const source = sourceSide === 'left' ? left : right;
    const result = applyUnifiedPatch(source.content, patchSession.patch, patchSession.reverse);
    if (!result.success) {
      setStatus(`Patch 应用失败（块 ${(result.failedHunk ?? 0) + 1}）：${result.error}`);
      return;
    }
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    const targetLabel = patchSession.reverse ? patchSession.patch.originalLabel : patchSession.patch.modifiedLabel;
    const preview: CompareDocument = { label: targetLabel.split(/[\\/]/).pop() ?? 'Patch 预览', content: result.content };
    if (targetSide === 'right') setRight(preview); else setLeft(preview);
    setActiveChange(-1);
    setStatus(`Patch 预览完成：已应用 ${result.appliedHunks} 个变更块，尚未写入磁盘`);
  };

  const exportJsonPatch = async () => {
    try {
      const patch = createJsonPatch(JSON.parse(left.content) as unknown, JSON.parse(right.content) as unknown);
      const result = await api.saveFile(`${JSON.stringify(patch, null, 2)}\n`, `${right.label.replace(/\.[^.]+$/, '') || 'comparison'}.jsonpatch`, { encoding: 'utf8', lineEnding: 'LF' });
      setStatus(result.success ? `已导出 JSON Patch（${patch.length} 个操作）` : result.error ?? '导出已取消');
    } catch (error) { setStatus(`JSON Patch 导出失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const importJsonPatch = async () => {
    const result = await api.pickFile({ accept: '.jsonpatch,.json' });
    const file = Array.isArray(result) ? result[0] : result;
    if (!file) return;
    try {
      const operations = JSON.parse(file.text ?? monaco.decodeBase64Utf8(file.content ?? '')) as JsonPatchOperation[];
      if (!Array.isArray(operations) || operations.some((item) => !item || !['add', 'remove', 'replace'].includes(item.op) || typeof item.path !== 'string')) throw new Error('JSON_PATCH_INVALID');
      const preview = applyJsonPatch(JSON.parse(left.content) as unknown, operations);
      setRight({ label: 'JSON Patch 预览.json', content: `${JSON.stringify(preview, null, 2)}\n` });
      setActiveChange(-1);
      setStatus(`JSON Patch 预览完成：${operations.length} 个操作，尚未写入磁盘`);
    } catch (error) { setStatus(`JSON Patch 导入失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const applyCurrent = (direction: 'left-to-right' | 'right-to-left') => {
    if (hunks.length === 0 || filtered) {
      if (filtered) setStatus('关闭忽略大小写/空行后才能应用差异');
      return;
    }
    const index = activeChange >= 0 ? Math.min(activeChange, hunks.length - 1) : 0;
    const hunk = hunks[index];
    const result = applyTextDiffHunk(left.content, right.content, hunk, direction);
    setLeft((current) => ({ ...current, content: result.original }));
    setRight((current) => ({ ...current, content: result.modified }));
    setActiveChange(-1);
    setStatus(`已将${direction === 'left-to-right' ? '左侧应用到右侧' : '右侧应用到左侧'}：差异 ${index + 1}`);
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
    setActiveChange(-1);
  };

  const handleMount: DiffOnMount = (editor) => {
    editorListenersRef.current.forEach((listener) => listener.dispose());
    editorRef.current = editor;
    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    editorListenersRef.current = [
      originalEditor.onDidChangeModelContent(() => {
        const content = originalEditor.getValue();
        setLeft((current) => current.content === content ? current : { ...current, content });
        setActiveChange(-1);
      }),
      modifiedEditor.onDidChangeModelContent(() => {
        const content = modifiedEditor.getValue();
        setRight((current) => current.content === content ? current : { ...current, content });
        setActiveChange(-1);
      }),
    ];
  };

  useEffect(() => () => editorListenersRef.current.forEach((listener) => listener.dispose()), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (activeActivity !== 'compare') return;
      if (event.key === 'F7') {
        event.preventDefault();
        navigate(event.shiftKey ? -1 : 1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDocument('right', event.shiftKey);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  const updatePreference = <K extends keyof ComparePreferences>(key: K, value: ComparePreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <h1 className="mr-2 text-sm font-semibold">文本比较</h1>
        <select className="h-7 rounded border bg-background px-2 text-xs" value={preferences.mode} onChange={(event) => updatePreference('mode', event.target.value as CompareMode)} aria-label="比较模式">
          <option value="plain">普通文本/代码</option><option value="chinese-word">中文词级</option><option value="paragraph">段落</option><option value="json">JSON 结构</option><option value="yaml">YAML 结构</option><option value="xml">XML 节点</option><option value="csv">CSV 表格</option><option value="markdown">Markdown 结构</option><option value="env">.env 键值</option>
        </select>
        <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={() => void openTwoFiles()} title="选择两个文件后立即比较"><FileDiff className="h-3.5 w-3.5" />比较文件</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openFile('left')}><FileText className="mr-1 h-3.5 w-3.5" />载入左侧</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openFile('right')}><FileText className="mr-1 h-3.5 w-3.5" />载入右侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={swap}><ArrowLeftRight className="h-3.5 w-3.5" />交换左右</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!left.path || left.content === left.savedContent} onClick={() => void saveDocument('left')}><Save className="h-3.5 w-3.5" />保存左侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!right.path || right.content === right.savedContent} onClick={() => void saveDocument('right')}><Save className="h-3.5 w-3.5" />保存右侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void saveDocument('right', true)}><Download className="h-3.5 w-3.5" />右侧另存为</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate(-1)}><ArrowLeft className="mr-1 h-3.5 w-3.5" />上一处</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate(1)}>下一处<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label="向左应用当前差异" disabled={hunks.length === 0 || filtered} onClick={() => applyCurrent('right-to-left')}><ArrowLeft className="h-3.5 w-3.5" />应用</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label="向右应用当前差异" disabled={hunks.length === 0 || filtered} onClick={() => applyCurrent('left-to-right')}>应用<ArrowRight className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label="向右应用全部差异" disabled={hunks.length === 0 || filtered} onClick={() => { setRight((current) => ({ ...current, content: left.content })); setActiveChange(-1); setStatus('已将左侧全部内容应用到右侧'); }}><ArrowRight className="h-3.5 w-3.5" />全部应用</Button>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreWhitespace} onChange={(event) => updatePreference('ignoreWhitespace', event.target.checked)} />忽略首尾空白</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreCase} onChange={(event) => updatePreference('ignoreCase', event.target.checked)} />忽略大小写</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreBlankLines} onChange={(event) => updatePreference('ignoreBlankLines', event.target.checked)} />忽略空行</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.hideUnchanged} onChange={(event) => updatePreference('hideUnchanged', event.target.checked)} />折叠未变化</label>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updatePreference('sideBySide', !preferences.sideBySide)}>{preferences.sideBySide ? <Rows3 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}{preferences.sideBySide ? '单栏视图' : '双栏视图'}</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void copyPatch()}><Copy className="mr-1 h-3.5 w-3.5" />复制 Diff</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void exportPatch()}><Download className="h-3.5 w-3.5" />导出 Patch</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void importPatch()}><Upload className="h-3.5 w-3.5" />导入 Patch</Button>
        {preferences.mode === 'json' && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void exportJsonPatch()}><Download className="h-3.5 w-3.5" />导出 JSON Patch</Button>}
        {preferences.mode === 'json' && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void importJsonPatch()}><Upload className="h-3.5 w-3.5" />导入 JSON Patch</Button>}
      </header>

      {preferences.mode === 'chinese-word' && <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={preferences.normalizeWidth} onChange={(event) => updatePreference('normalizeWidth', event.target.checked)} />全角/半角归一化</label><label className="flex items-center gap-1"><input type="checkbox" checked={preferences.ignorePunctuation} onChange={(event) => updatePreference('ignorePunctuation', event.target.checked)} />忽略标点</label></div>}
      {preferences.mode === 'json' && <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs"><label>数组匹配字段 <input className="ml-1 h-6 w-28 rounded border bg-background px-2" value={preferences.jsonArrayKey} onChange={(event) => updatePreference('jsonArrayKey', event.target.value)} placeholder="如 id" /></label><label className="flex items-center gap-1"><input type="checkbox" checked={preferences.jsonOnlyChanges} onChange={(event) => updatePreference('jsonOnlyChanges', event.target.checked)} />只显示值变化</label>{structuredComparison.error && <span className="text-destructive">JSON 解析失败：{structuredComparison.error}</span>}</div>}
      {preferences.mode === 'env' && <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={preferences.envRedactSecrets} onChange={(event) => updatePreference('envRedactSecrets', event.target.checked)} />隐藏密钥值</label><span className="text-muted-foreground">匹配 KEY、TOKEN、SECRET、PASSWORD、PWD、PRIVATE_KEY、CREDENTIAL</span>{structuredComparison.error && <span className="text-destructive">.env 解析失败：{structuredComparison.error}</span>}</div>}
      {preferences.mode === 'yaml' && <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs"><label>数组匹配字段 <input className="ml-1 h-6 w-28 rounded border bg-background px-2" value={preferences.jsonArrayKey} onChange={(event) => updatePreference('jsonArrayKey', event.target.value)} placeholder="如 id" /></label><span className="text-muted-foreground">自动按键名规范化</span></div>}
      {preferences.mode !== 'json' && preferences.mode !== 'env' && structuredComparison.error && <div className="shrink-0 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">结构化解析失败：{structuredComparison.error}</div>}

      {saveConflict && (
        <div role="alert" className="flex min-h-10 shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 text-xs">
          <span className="font-medium">{saveConflict.side === 'left' ? left.label : right.label} 已被外部修改。</span>
          <span className="text-muted-foreground">请选择如何处理本地未保存内容。</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={loadExternalVersion}>载入外部版本</Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void saveDocument(saveConflict.side, true)}>另存为</Button>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void saveDocument(saveConflict.side, false, true)}>强制覆盖</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSaveConflict(null)}>取消</Button>
        </div>
      )}

      {patchSession && (
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/5 px-3 text-xs">
          <span className="font-medium">{patchSession.name}</span>
          <span className="text-muted-foreground">{patchSession.patch.originalLabel} → {patchSession.patch.modifiedLabel} · {patchSession.patch.hunks.length} 个块</span>
          <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={patchSession.reverse} onChange={(event) => setPatchSession((current) => current ? { ...current, reverse: event.target.checked } : null)} />反向应用</label>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => previewPatch('left')}>以左侧为基准预览 →</Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => previewPatch('right')}>← 以右侧为基准预览</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPatchSession(null)}>关闭 Patch</Button>
        </div>
      )}

      {preferences.mode === 'json' && structuredComparison.jsonChanges.length > 0 && (
        <details className="shrink-0 border-b bg-muted/20 text-xs">
          <summary className="cursor-pointer px-3 py-2 font-medium">JSON 树状差异（{structuredComparison.jsonChanges.length}）</summary>
          <div className="max-h-36 overflow-auto border-t px-3 py-2 font-mono">
            {structuredComparison.jsonChanges.slice(0, 200).map((change) => <div key={`${change.type}:${change.path}`} className="grid grid-cols-[5rem_minmax(10rem,1fr)_2fr_2fr] gap-2 py-0.5"><span>{change.type}</span><span>{change.path}</span><span className="truncate text-destructive">{change.before === undefined ? '' : JSON.stringify(change.before)}</span><span className="truncate text-success">{change.after === undefined ? '' : JSON.stringify(change.after)}</span></div>)}
          </div>
        </details>
      )}

      <div className="grid h-8 shrink-0 grid-cols-2 border-b bg-muted/30 text-xs">
        {([left, right] as const).map((document, index) => <div key={index} className="flex min-w-0 items-center border-r px-3 last:border-r-0"><span className="truncate font-medium">{document.label}</span>{document.content !== document.savedContent && document.path && <span className="ml-2 text-warning">未保存</span>}{document.encoding && <span className="ml-2 text-muted-foreground">{document.encoding.toUpperCase()} · {document.lineEnding}</span>}</div>)}
      </div>
      <div className="min-h-0 flex-1">
        {preferences.sideBySide ? <DiffEditor
          original={displayLeft}
          modified={displayRight}
          language={language}
          originalModelPath={`inmemory://compare/original/${encodeURIComponent(left.label)}`}
          modifiedModelPath={`inmemory://compare/modified/${encodeURIComponent(right.label)}`}
          theme={dark ? 'vs-dark' : 'light'}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            readOnly: false,
            originalEditable: true,
            diffAlgorithm: 'advanced',
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: true,
            ignoreTrimWhitespace: preferences.ignoreWhitespace,
            hideUnchangedRegions: { enabled: preferences.hideUnchanged, contextLineCount: 3, minimumLineCount: 8, revealLineCount: 20 },
            maxComputationTime: 5000,
            maxFileSize: 20,
            renderOverviewRuler: true,
            minimap: {
              enabled: true,
              side: 'right',
              showSlider: 'mouseover',
              renderCharacters: true,
              maxColumn: 120,
            },
            folding: true,
            foldingStrategy: 'auto',
            showFoldingControls: 'always',
            unfoldOnClickAfterEndOfLine: true,
            stickyScroll: { enabled: true, maxLineCount: 5 },
            bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
            guides: {
              indentation: true,
              bracketPairs: true,
              bracketPairsHorizontal: true,
              highlightActiveIndentation: true,
              highlightActiveBracketPair: true,
            },
            colorDecorators: true,
            matchBrackets: 'always',
            wordWrap: 'on',
          }}
        /> : <div ref={unifiedViewRef} className="h-full"><UnifiedDiffView
          original={displayLeft}
          modified={displayRight}
          hunks={hunks}
          activeHunk={activeChange}
          hideUnchanged={preferences.hideUnchanged}
          wordLevel={preferences.mode === 'chinese-word'}
        /></div>}
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
        <span>{diffComputing ? '正在计算差异…' : `${hunks.length} 个差异块`}</span><span>{language}</span>{usingWorker && <span>后台计算</span>}<span>F7/Shift+F7 导航</span>{filtered && <span className="text-warning">筛选模式仅影响显示</span>}{diffError && <span className="text-warning">{diffError}</span>}<span className="truncate">{status}</span>
      </footer>
    </div>
  );
};
