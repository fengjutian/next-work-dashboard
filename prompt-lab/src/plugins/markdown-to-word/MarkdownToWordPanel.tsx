import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Upload } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { markdownToDocx } from './converter';

const SAMPLE = `# Markdown 转 Word

在这里粘贴 Markdown，或打开本地 .md 文件。

- 支持标题、列表和 **粗体**
- 支持引用、代码块与表格
`;

function suggestedName(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || 'Markdown文档').replace(/[<>:"/\\|?*]/g, '_');
}

export function MarkdownToWordPanel() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [fileName, setFileName] = useState('Markdown文档');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const openFile = useCallback(async () => {
    const picked = await window.electronAPI.pickFile({ accept: '.md,.markdown,.txt' });
    const file = Array.isArray(picked) ? picked[0] : picked;
    if (!file) return;
    try {
      const text = file.text ?? new TextDecoder(file.encoding === 'gbk' ? 'gbk' : 'utf-8').decode(Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)));
      setMarkdown(text);
      setFileName(file.name.replace(/\.(md|markdown|txt)$/i, '') || suggestedName(text));
      setMessage(`已打开 ${file.name}`);
    } catch { setMessage('无法读取该文件，请确认文件是文本格式。'); }
  }, []);

  const exportWord = useCallback(async () => {
    if (!markdown.trim()) { setMessage('请输入 Markdown 内容。'); return; }
    setBusy(true);
    setMessage('正在生成 Word 文档…');
    try {
      const data = await markdownToDocx(markdown, { title: fileName || suggestedName(markdown) });
      const result = await window.electronAPI.markdownToWord.save(data, fileName || suggestedName(markdown));
      setMessage(result.success ? `已导出：${result.filePath}` : result.error === 'CANCELLED' ? '已取消导出。' : `导出失败：${result.error || '未知错误'}`);
    } catch (error) { setMessage(`生成失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }, [fileName, markdown]);

  useEffect(() => {
    const handler = () => { void exportWord(); };
    window.addEventListener('markdown-to-word:export', handler);
    return () => window.removeEventListener('markdown-to-word:export', handler);
  }, [exportWord]);

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex items-center gap-3 border-b px-5 py-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary"><FileText className="h-5 w-5" /></div>
      <div><h1 className="text-base font-semibold">Markdown 转 Word</h1><p className="text-xs text-muted-foreground">将 Markdown 排版并导出为可编辑的 .docx 文档</p></div>
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={() => void openFile()}><Upload />打开 Markdown</Button>
      <Button size="sm" disabled={busy || !markdown.trim()} onClick={() => void exportWord()}><Download />{busy ? '生成中…' : '导出 Word'}</Button>
    </header>
    <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-2">
      <label htmlFor="word-file-name" className="text-xs text-muted-foreground">文件名</label>
      <input id="word-file-name" value={fileName} onChange={(event) => setFileName(event.target.value)} className="h-8 w-64 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="文档名称" />
      <span className="text-xs text-muted-foreground">.docx</span>
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">{markdown.length.toLocaleString()} 字符</span>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]">
      <textarea aria-label="Markdown 内容" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck={false} className="h-full min-h-0 resize-none border-0 bg-background p-5 font-mono text-sm leading-6 outline-none" placeholder="# 输入 Markdown 内容…" />
      <aside className="border-l bg-muted/20 p-5 text-sm">
        <h2 className="mb-3 font-medium">支持的格式</h2>
        <ul className="space-y-2 text-xs leading-5 text-muted-foreground"><li>六级标题与普通段落</li><li>有序、无序及嵌套列表</li><li>粗体、斜体、删除线、行内代码</li><li>引用、代码块、分隔线</li><li>GFM 表格与链接文本</li><li>中文字体与 A4 页面设置</li></ul>
      </aside>
    </div>
    <footer aria-live="polite" className="min-h-9 border-t px-5 py-2 text-xs text-muted-foreground">{message || 'Word 文档在本地生成，内容不会上传。'}</footer>
  </div>;
}
