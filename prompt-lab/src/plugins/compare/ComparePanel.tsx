import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { ArrowLeft, ArrowRight, Copy, FileText } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { configureMonaco } from '@/lib/monaco-setup';
import { applyTextDiffHunk, createUnifiedDiff, prepareTextForComparison } from '@/lib/text-diff';
import { createUnifiedDiffAsync } from '@/lib/text-diff-client';
import { decodeBase64Utf8, languageIdFromName } from '@/plugins/code-editor/editor-utils';
import type { FilePickResult, WorkspaceEncoding } from '@/types/electron';
import { DIFF_WORKER_THRESHOLD, useTextDiffHunks } from './useTextDiffHunks';

configureMonaco();

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

const sampleLeft = `function greet(name: string) {\n  return 'Hello, ' + name;\n}\n`;
const sampleRight = `function greet(name: string) {\n  return \`Hello, \${name}!\`;\n}\n`;

interface ComparePreferences {
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreBlankLines: boolean;
  hideUnchanged: boolean;
  inputsVisible: boolean;
}

const defaultPreferences: ComparePreferences = {
  sideBySide: true,
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
  hideUnchanged: true,
  inputsVisible: true,
};

function readPreferences(): ComparePreferences {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem('compare.preferences.v1') ?? '{}') };
  } catch {
    return defaultPreferences;
  }
}

export const ComparePanel: React.FC = () => {
  const theme = useStore((state) => state.theme);
  const activeActivity = useStore((state) => state.activeActivity);
  const [left, setLeft] = useState<CompareDocument>({ label: '原始文本.ts', content: sampleLeft });
  const [right, setRight] = useState<CompareDocument>({ label: '修改后.ts', content: sampleRight });
  const [preferences, setPreferences] = useState(readPreferences);
  const [activeChange, setActiveChange] = useState(-1);
  const [status, setStatus] = useState('可直接粘贴文本，或从文件载入');
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const displayLeft = useMemo(() => prepareTextForComparison(left.content, preferences), [left.content, preferences]);
  const displayRight = useMemo(() => prepareTextForComparison(right.content, preferences), [preferences, right.content]);
  const { hunks, computing: diffComputing, error: diffError, worker: usingWorker } = useTextDiffHunks(displayLeft, displayRight);
  const filtered = preferences.ignoreCase || preferences.ignoreBlankLines;
  const language = languageIdFromName(right.label || left.label);
  const dark = theme === 'dark' || (theme === 'system' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    localStorage.setItem('compare.preferences.v1', JSON.stringify(preferences));
  }, [preferences]);

  const documentFromFile = (file: FilePickResult): CompareDocument => ({
    label: file.name,
    content: file.text ?? decodeBase64Utf8(file.content),
    savedContent: file.text ?? decodeBase64Utf8(file.content),
    path: file.path,
    encoding: file.encoding ?? 'utf8',
    lineEnding: file.lineEnding ?? 'LF',
    modifiedAt: file.modifiedAt,
    readOnly: file.readOnly,
  });

  const openFile = async (side: 'left' | 'right') => {
    const result = await window.electronAPI.pickFile();
    const file = Array.isArray(result) ? result[0] : result;
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
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
    const result = await window.electronAPI.pickFile({ multiple: true });
    const files = Array.isArray(result) ? result : result ? [result] : [];
    if (files.length !== 2) {
      setStatus('请选择两个文本文件');
      return;
    }
    if (files.some((file) => file.size > 20 * 1024 * 1024)) {
      setStatus('文件超过 20MB，已拒绝载入');
      return;
    }
    try {
      setLeft(documentFromFile(files[0]));
      setRight(documentFromFile(files[1]));
      setActiveChange(-1);
      setStatus(`正在比较 ${files[0].name} 与 ${files[1].name}`);
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
    const options = { encoding: document.encoding ?? 'utf8', lineEnding: document.lineEnding ?? 'LF' };
    let result: Awaited<ReturnType<typeof window.electronAPI.writeTextFile>>;
    if (document.path && !saveAs) {
      result = await window.electronAPI.writeTextFile(document.path, document.content, { ...options, expectedModifiedAt: document.modifiedAt, force });
    } else {
      result = await window.electronAPI.saveFile(document.content, document.label, options);
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
        ? await createUnifiedDiffAsync(left.content, right.content, left.label, right.label)
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
    editorRef.current = editor;
  };

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
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openTwoFiles()}><FileText className="mr-1 h-3.5 w-3.5" />选择两个文件</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openFile('left')}><FileText className="mr-1 h-3.5 w-3.5" />载入左侧</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openFile('right')}><FileText className="mr-1 h-3.5 w-3.5" />载入右侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={swap}>交换左右</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!left.path || left.content === left.savedContent} onClick={() => void saveDocument('left')}>保存左侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!right.path || right.content === right.savedContent} onClick={() => void saveDocument('right')}>保存右侧</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void saveDocument('right', true)}>右侧另存为</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate(-1)}><ArrowLeft className="mr-1 h-3.5 w-3.5" />上一处</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate(1)}>下一处<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={hunks.length === 0 || filtered} onClick={() => applyCurrent('right-to-left')}>← 应用</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={hunks.length === 0 || filtered} onClick={() => applyCurrent('left-to-right')}>应用 →</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={hunks.length === 0 || filtered} onClick={() => { setRight((current) => ({ ...current, content: left.content })); setActiveChange(-1); setStatus('已将左侧全部内容应用到右侧'); }}>全部应用 →</Button>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreWhitespace} onChange={(event) => updatePreference('ignoreWhitespace', event.target.checked)} />忽略首尾空白</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreCase} onChange={(event) => updatePreference('ignoreCase', event.target.checked)} />忽略大小写</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.ignoreBlankLines} onChange={(event) => updatePreference('ignoreBlankLines', event.target.checked)} />忽略空行</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={preferences.hideUnchanged} onChange={(event) => updatePreference('hideUnchanged', event.target.checked)} />折叠未变化</label>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updatePreference('sideBySide', !preferences.sideBySide)}>{preferences.sideBySide ? '行内视图' : '双栏视图'}</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updatePreference('inputsVisible', !preferences.inputsVisible)}>{preferences.inputsVisible ? '隐藏输入' : '显示输入'}</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void copyPatch()}><Copy className="mr-1 h-3.5 w-3.5" />复制 Diff</Button>
      </header>

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

      {preferences.inputsVisible && (
        <div className="grid h-44 shrink-0 grid-cols-2 gap-px border-b bg-border">
          {([
            { side: 'left' as const, value: left, setter: setLeft },
            { side: 'right' as const, value: right, setter: setRight },
          ]).map(({ side, value, setter }) => (
            <label key={side} className="flex min-w-0 flex-col bg-background">
              <div className="flex h-8 items-center border-b bg-muted/40 px-3 text-xs">
                <input className="min-w-0 flex-1 bg-transparent font-medium outline-none" value={value.label} onChange={(event) => setter((current) => ({ ...current, label: event.target.value }))} aria-label={`${side === 'left' ? '左' : '右'}侧名称`} />
                {value.content !== value.savedContent && value.path && <span className="ml-2 text-warning">未保存</span>}
                {value.encoding && <span className="ml-2 text-muted-foreground">{value.encoding.toUpperCase()} · {value.lineEnding}</span>}
              </div>
              <textarea className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs leading-5 outline-none" value={value.content} onChange={(event) => { setter((current) => ({ ...current, content: event.target.value })); setActiveChange(-1); }} spellCheck={false} aria-label={`${side === 'left' ? '左' : '右'}侧文本`} />
            </label>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <DiffEditor
          original={displayLeft}
          modified={displayRight}
          language={language}
          originalModelPath={`inmemory://compare/original/${encodeURIComponent(left.label)}`}
          modifiedModelPath={`inmemory://compare/modified/${encodeURIComponent(right.label)}`}
          theme={dark ? 'vs-dark' : 'light'}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            readOnly: true,
            diffAlgorithm: 'advanced',
            renderSideBySide: preferences.sideBySide,
            useInlineViewWhenSpaceIsLimited: true,
            ignoreTrimWhitespace: preferences.ignoreWhitespace,
            hideUnchangedRegions: { enabled: preferences.hideUnchanged, contextLineCount: 3, minimumLineCount: 8, revealLineCount: 20 },
            maxComputationTime: 5000,
            maxFileSize: 20,
            renderOverviewRuler: true,
            minimap: { enabled: false },
            wordWrap: 'on',
          }}
        />
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
        <span>{diffComputing ? '正在计算差异…' : `${hunks.length} 个差异块`}</span><span>{language}</span>{usingWorker && <span>后台计算</span>}<span>F7/Shift+F7 导航</span>{filtered && <span className="text-warning">筛选模式仅影响显示</span>}{diffError && <span className="text-warning">{diffError}</span>}<span className="truncate">{status}</span>
      </footer>
    </div>
  );
};
