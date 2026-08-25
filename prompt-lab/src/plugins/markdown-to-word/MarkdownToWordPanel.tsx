import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Columns2, Download, Edit3, Eye, FileText, Upload } from '@/components/icons';
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
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split');
  const [sourcePath, setSourcePath] = useState<string>();
  const [author, setAuthor] = useState('');
  const [fontFamily, setFontFamily] = useState('Microsoft YaHei');
  const [fontSize, setFontSize] = useState(11);
  const [lineSpacing, setLineSpacing] = useState(1.5);
  const [marginCm, setMarginCm] = useState(2.54);
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [cover, setCover] = useState(false);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [chapterNumbering, setChapterNumbering] = useState(false);
  const [tableZebra, setTableZebra] = useState(true);
  const [plantUmlServer, setPlantUmlServer] = useState('');
  const [template, setTemplate] = useState<'standard' | 'business' | 'academic'>('standard');

  const openFile = useCallback(async () => {
    const picked = await window.electronAPI.pickFile({ accept: '.md,.markdown,.txt' });
    const file = Array.isArray(picked) ? picked[0] : picked;
    if (!file) return;
    try {
      const text = file.text ?? new TextDecoder(file.encoding === 'gbk' ? 'gbk' : 'utf-8').decode(Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)));
      setMarkdown(text);
      setSourcePath(file.path);
      setFileName(file.name.replace(/\.(md|markdown|txt)$/i, '') || suggestedName(text));
      setMessage(`已打开 ${file.name}`);
    } catch { setMessage('无法读取该文件，请确认文件是文本格式。'); }
  }, []);

  const exportWord = useCallback(async () => {
    if (!markdown.trim()) { setMessage('请输入 Markdown 内容。'); return; }
    setBusy(true);
    setMessage('正在生成 Word 文档…');
    try {
      const data = await markdownToDocx(markdown, {
        title: fileName || suggestedName(markdown), author, fontFamily, fontSize, lineSpacing, marginCm,
        header, footer, cover, pageNumbers, chapterNumbering, tableZebra, sourcePath, template,
        resolveImage: (source) => window.electronAPI.markdownToWord.loadAsset(source, sourcePath),
        renderDiagram: async (language, source) => {
          if (language === 'plantuml') return plantUmlServer ? window.electronAPI.markdownToWord.renderPlantUml(source, plantUmlServer) : null;
          const mermaid = (await import('mermaid')).default;
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
          const { svg } = await mermaid.render(`md-word-${crypto.randomUUID()}`, source);
          const bytes = new TextEncoder().encode(svg);
          return { data: bytes.buffer, mimeType: 'image/svg+xml' };
        },
      });
      const result = await window.electronAPI.markdownToWord.save(data, fileName || suggestedName(markdown));
      setMessage(result.success ? `已导出：${result.filePath}` : result.error === 'CANCELLED' ? '已取消导出。' : `导出失败：${result.error || '未知错误'}`);
    } catch (error) { setMessage(`生成失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }, [author, chapterNumbering, cover, fileName, fontFamily, fontSize, footer, header, lineSpacing, marginCm, markdown, pageNumbers, plantUmlServer, sourcePath, tableZebra, template]);

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
      <div className="flex rounded-md border bg-background p-0.5">
        <button type="button" onClick={() => setView('edit')} title="仅编辑" className={`rounded p-1.5 ${view === 'edit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Edit3 className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setView('split')} title="分屏预览" className={`rounded p-1.5 ${view === 'split' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Columns2 className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setView('preview')} title="仅预览" className={`rounded p-1.5 ${view === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Eye className="h-3.5 w-3.5" /></button>
      </div>
      <span className="text-xs text-muted-foreground">{markdown.length.toLocaleString()} 字符</span>
    </div>
    <div className={`grid min-h-0 flex-1 ${view === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {view !== 'preview' && <textarea aria-label="Markdown 内容" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck={false} className="h-full min-h-0 resize-none border-0 bg-background p-5 font-mono text-sm leading-6 outline-none" placeholder="# 输入 Markdown 内容…" />}
      {view !== 'edit' && <div aria-label="Markdown 预览" className={`min-h-0 overflow-auto bg-white p-8 text-slate-900 ${view === 'split' ? 'border-l' : ''}`}>
        <article className="prose prose-slate mx-auto max-w-4xl prose-headings:scroll-mt-4 prose-pre:overflow-auto prose-table:block prose-table:overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      </div>}
    </div>
    <div className="border-t bg-muted/20 px-5 py-2">
      <details className="mb-2">
        <summary className="cursor-pointer select-none text-xs font-medium">Word 排版与文档设置</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4 xl:grid-cols-6">
          <label>样式模板<select value={template} onChange={(event) => { const value = event.target.value as typeof template; setTemplate(value); if (value === 'business') { setFontFamily('Aptos'); setLineSpacing(1.15); } else if (value === 'academic') { setFontFamily('Times New Roman'); setLineSpacing(2); } else { setFontFamily('Microsoft YaHei'); setLineSpacing(1.5); } }} className="mt-1 h-8 w-full rounded border bg-background px-2"><option value="standard">标准中文</option><option value="business">商务报告</option><option value="academic">学术论文</option></select></label>
          <label>作者<input value={author} onChange={(event) => setAuthor(event.target.value)} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>字体<input value={fontFamily} onChange={(event) => setFontFamily(event.target.value)} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>字号（pt）<input type="number" min="8" max="36" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>行距<input type="number" min="1" max="3" step="0.1" value={lineSpacing} onChange={(event) => setLineSpacing(Number(event.target.value))} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>页边距（cm）<input type="number" min="1" max="5" step="0.1" value={marginCm} onChange={(event) => setMarginCm(Number(event.target.value))} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>页眉<input value={header} onChange={(event) => setHeader(event.target.value)} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label>页脚<input value={footer} onChange={(event) => setFooter(event.target.value)} className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label className="md:col-span-2">PlantUML 服务（可选）<input value={plantUmlServer} onChange={(event) => setPlantUmlServer(event.target.value)} placeholder="https://www.plantuml.com/plantuml" className="mt-1 h-8 w-full rounded border bg-background px-2" /></label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={cover} onChange={(event) => setCover(event.target.checked)} />生成封面</label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={pageNumbers} onChange={(event) => setPageNumbers(event.target.checked)} />显示页码</label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={chapterNumbering} onChange={(event) => setChapterNumbering(event.target.checked)} />章节自动编号</label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={tableZebra} onChange={(event) => setTableZebra(event.target.checked)} />表格斑马纹</label>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer select-none text-xs font-medium">支持的格式与导出能力</summary>
        <div className="mt-2 grid max-h-28 grid-cols-2 gap-x-8 gap-y-1 overflow-auto text-xs leading-5 text-muted-foreground md:grid-cols-4">
          <span>六级标题与普通段落</span><span>有序、无序及嵌套列表</span><span>GFM 任务清单</span>
          <span>粗体、斜体与删除线</span><span>行内代码与代码块</span><span>引用与嵌套引用</span>
          <span>GFM 表格</span><span>行内链接与自动网址</span><span>图片说明及替代文本</span>
          <span>分隔线与换行</span><span>Markdown 转义字符</span><span>中文字体与 A4 页面</span>
          <span>目录占位符 [TOC]</span><span>分页符 \pagebreak</span><span>脚注 [^1]</span>
          <span>术语与定义列表</span><span>==文本高亮==</span><span>^上标^ 与 ~下标~</span>
          <span>邮箱地址</span><span>代码语言标签</span><span>YAML Front Matter</span>
          <span>本地/网络图片嵌入</span><span>图片宽度、对齐与题注</span><span>页眉、页脚与页码</span>
          <span>封面与文档元数据</span><span>表格列宽、对齐与斑马纹</span><span>代码语法高亮</span>
          <span>LaTeX 线性公式</span><span>Mermaid 与 PlantUML</span><span>NOTE/TIP/WARNING 提示块</span>
          <span>原生 Word 脚注</span><span>参考文献与文内引用</span><span>常见 HTML 与 HTML 表格</span>
          <span>三套 Word 样式模板</span><span>Emoji 与 Unicode</span><span>Word 可编辑内容</span><span>本地离线生成</span><span>实时安全预览</span>
        </div>
      </details>
    </div>
    <footer aria-live="polite" className="min-h-9 border-t px-5 py-2 text-xs text-muted-foreground">{message || 'Word 文档在本地生成，内容不会上传。'}</footer>
  </div>;
}
