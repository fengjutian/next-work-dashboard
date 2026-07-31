import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code, FolderOpen, Download } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { FilePickResult } from '@/types/electron';

const CODE_EXTENSIONS = [
  '.txt', '.md', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.html', '.css', '.scss', '.less',
  '.py', '.java', '.kt', '.kts', '.go', '.rs', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.php', '.rb', '.swift', '.sql', '.sh', '.ps1', '.bat',
  '.dockerfile', '.gitignore', '.env',
];

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.some((byte) => byte === 0)) {
    throw new Error('检测到二进制内容，代码编辑器仅支持文本文件');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function languageFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'Dockerfile';
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const names: Record<string, string> = {
    js: 'JavaScript', jsx: 'JavaScript React', ts: 'TypeScript', tsx: 'TypeScript React',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin',
    c: 'C', h: 'C Header', cpp: 'C++', hpp: 'C++ Header', cs: 'C#',
    html: 'HTML', css: 'CSS', scss: 'SCSS', vue: 'Vue', svelte: 'Svelte',
    json: 'JSON', jsonc: 'JSON with Comments', md: 'Markdown', sql: 'SQL',
    sh: 'Shell', ps1: 'PowerShell', yaml: 'YAML', yml: 'YAML', xml: 'XML',
  };
  return names[extension] ?? (extension ? extension.toUpperCase() : 'Plain Text');
}

export const CodeEditorPanel: React.FC = () => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState('就绪');
  const gutterRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dirty = content !== savedContent;

  const lineCount = useMemo(() => Math.max(1, content.split('\n').length), [content]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'),
    [lineCount],
  );

  const openFile = useCallback(async () => {
    if (dirty && !window.confirm('当前修改尚未保存，仍要打开其他文件吗？')) return;
    const result = await window.electronAPI.pickFile({
      accept: CODE_EXTENSIONS.join(','),
      multiple: false,
    });
    const file = (Array.isArray(result) ? result[0] : result) as FilePickResult | null;
    if (!file) return;
    try {
      const text = decodeBase64Utf8(file.content);
      setFilePath(file.path);
      setFileName(file.name);
      setContent(text);
      setSavedContent(text);
      setStatus(`已打开 · ${(file.size / 1024).toFixed(1)} KB`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开失败');
    }
  }, [dirty]);

  const save = useCallback(async () => {
    if (!filePath) return;
    setStatus('保存中…');
    const result = await window.electronAPI.writeTextFile(filePath, content);
    if (result.success) {
      setSavedContent(content);
      setStatus('已保存');
    } else {
      setStatus(`保存失败：${result.error ?? '未知错误'}`);
    }
  }, [content, filePath]);

  const saveAs = useCallback(async () => {
    const result = await window.electronAPI.saveFile(content, fileName || 'untitled.txt');
    if (result.success) {
      setFilePath(result.path ?? null);
      setFileName(result.path?.split(/[\\/]/).pop() ?? fileName);
      setSavedContent(content);
      setStatus('已另存');
    }
  }, [content, fileName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (filePath) void save();
        else void saveAs();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filePath, save, saveAs]);

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${content.slice(0, start)}  ${content.slice(end)}`;
    setContent(next);
    requestAnimationFrame(() => {
      element.selectionStart = element.selectionEnd = start + 2;
    });
  };

  return (
    <div className="flex h-full flex-col bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Code className="h-4 w-4 text-blue-500" />
        <span className="max-w-64 truncate text-xs font-semibold">
          {fileName || '代码编辑器'}{dirty ? ' ●' : ''}
        </span>
        {fileName && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
            {languageFromName(fileName)}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={openFile}>
          <FolderOpen className="h-3.5 w-3.5" /> 打开
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!filePath || !dirty} onClick={save}>
          保存
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!fileName} onClick={saveAs}>
          <Download className="h-3.5 w-3.5" /> 另存为
        </Button>
      </header>

      {fileName ? (
        <div className="flex min-h-0 flex-1 overflow-hidden bg-zinc-50 font-mono text-[13px] leading-5 dark:bg-zinc-950">
          <div
            ref={gutterRef}
            className="w-14 shrink-0 overflow-hidden border-r bg-zinc-100 py-3 pr-3 text-right text-zinc-400 select-none dark:bg-zinc-900"
            aria-hidden="true"
          >
            <pre className="m-0 font-inherit leading-5">{lineNumbers}</pre>
          </div>
          <textarea
            ref={editorRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            onScroll={(event) => {
              if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none overflow-auto border-0 bg-transparent p-3 font-mono leading-5 text-zinc-800 outline-none whitespace-pre dark:text-zinc-200"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
          <Code className="h-12 w-12 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm">打开本地代码或文本文件开始编辑</p>
          <Button variant="outline" onClick={openFile}>选择文件</Button>
        </div>
      )}

      <footer className="flex h-7 shrink-0 items-center justify-between border-t px-3 text-[10px] text-zinc-400">
        <span className="truncate">{filePath ?? '未打开文件'}</span>
        <span>{lineCount} 行 · {content.length} 字符 · {status}</span>
      </footer>
    </div>
  );
};
