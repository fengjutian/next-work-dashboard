import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Copy, Download, HanyuJinjie, History, Loader2, RefreshCw, Send, Sparkles, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { dbDeleteHanyuJinjieExecution, dbLoadHanyuJinjieExecutions, dbSaveHanyuJinjieExecution, flushDbToDisk, isDbReady, type HanyuJinjieExecution } from '@/db';
import { useStore } from '@/store/store';
import { extractExplanation, safeCardFilename, sanitizeGeneratedSvg, svgToPngBlob } from './svg';
import { exportEpub, exportPdf, type BookMetadata } from './book-export';

const SYSTEM_PROMPT = `(defun 新汉语老师 ()
"你是年轻人,批判现实,思考深刻,语言风趣"
(风格 . ("Oscar Wilde" "鲁迅" "罗永浩"))
(擅长 . 一针见血)
(表达 . 隐喻)
(批判 . 讽刺幽默))
(defun 汉语新解 (用户输入)
"你会用一个特殊视角来解释一个词汇"
(let (解释 (精练表达
(隐喻 (一针见血 (辛辣讽刺 (抓住本质 用户输入))))))
(few-shots (委婉 . "刺向他人时, 决定在剑刃上撒上止痛药。"))
(SVG-Card 解释)))
(defun SVG-Card (解释)
"输出SVG 卡片"
(setq design-rule "合理使用负空间，整体排版要有呼吸感"
design-principles '(干净 简洁 典雅))
(设置画布 '(宽度 400 高度 600 边距 20))
(标题字体 '毛笔楷体)
(自动缩放 '(最小字号 16))
(配色风格 '((背景色 (蒙德里安风格 设计感)))
(主要文字 (汇文明朝体 粉笔灰))
(装饰图案 随机几何图))
(卡片元素 ((居中标题 "汉语新解")
分隔线
(排版输出 用户输入 英文 日语)
解释
(线条图 (批判内核 解释))
(极简总结 线条图))))
(defun start ()
"启动时运行"
(let (system-role 新汉语老师)
(print "说吧, 他们又用哪个词来忽悠你了?")))
;; 运行规则
;; 1. 启动时必须运行 (start) 函数
;; 2. 之后调用主函数 (汉语新解 用户输入)
;; 3. 输出完整 SVG 后，必须紧接 <explanation>详解</explanation>
;; 4. 详解必须是纯文本，不超过 300 个汉字；抓住词语背后的权力关系、利益结构或自我欺骗，犀利、一针见血，不复述卡片文案`;

const EXAMPLES = ['内卷', '躺平', '赋能', '情绪价值', '松弛感', '已读不回'];
const MAX_WORD_LENGTH = 24;

async function llmChat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[]): Promise<string> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, { model, temperature: 0.82, maxTokens: 4_096, stream: true })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }
  return chunks.join('');
}

function errorMessage(reason: unknown): string {
  if (!(reason instanceof Error)) return '生成失败，请稍后重试';
  if (/aborted|aborterror/i.test(reason.message)) return '生成请求被中止，请重试；如果持续出现，请更换响应更快的模型';
  return reason.message;
}

function lispString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

export const HanyuJinjiePanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [input, setInput] = useState('');
  const [generatedWord, setGeneratedWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [executions, setExecutions] = useState<HanyuJinjieExecution[]>([]);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookEntries, setBookEntries] = useState<string[]>([]);
  const [bookMetadata, setBookMetadata] = useState<BookMetadata>({ title: '汉语新解集', author: '', description: '那些被漂亮话包装起来的现实，值得重新拆开看一遍。' });
  const [exporting, setExporting] = useState<'epub' | 'pdf' | null>(null);
  const requestIdRef = useRef(0);
  const copyTimerRef = useRef<number>();

  useEffect(() => () => {
    requestIdRef.current += 1;
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  const reloadExecutions = useCallback(() => {
    if (!isDbReady()) return false;
    try { setExecutions(dbLoadHanyuJinjieExecutions()); } catch { setExecutions([]); }
    return true;
  }, []);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => { attempts += 1; if (reloadExecutions() || attempts >= 30) window.clearInterval(timer); }, 100);
    return () => window.clearInterval(timer);
  }, [reloadExecutions]);

  const persistExecution = useCallback(async (execution: Omit<HanyuJinjieExecution, 'id' | 'createdAt'>): Promise<string | null> => {
    if (!isDbReady()) return null;
    try {
      const id = crypto.randomUUID();
      dbSaveHanyuJinjieExecution({ ...execution, id, createdAt: Date.now() });
      await flushDbToDisk(); reloadExecutions();
      return id;
    } catch { return null; /* Persistence must not hide a generated card or its original error. */ }
  }, [reloadExecutions]);

  const handleDeleteExecution = useCallback(async (id: string) => {
    try {
      dbDeleteHanyuJinjieExecution(id);
      await flushDbToDisk();
      setExecutions((current) => current.filter((execution) => execution.id !== id));
      if (selectedExecutionId === id) {
        setSelectedExecutionId(null); setGeneratedWord(''); setSvgContent(null); setExplanation(''); setError(null);
      }
    } catch { setError('删除记录失败，请稍后重试'); }
  }, [selectedExecutionId]);

  const openBookEditor = useCallback(() => {
    setBookEntries(executions.filter((entry) => entry.status === 'success' && entry.svgContent && entry.explanation).map((entry) => entry.id));
    setBookOpen(true); setError(null);
  }, [executions]);

  const moveBookEntry = useCallback((id: string, offset: -1 | 1) => setBookEntries((current) => {
    const index = current.indexOf(id); const target = index + offset;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  }), []);

  const handleBookExport = useCallback(async (format: 'epub' | 'pdf') => {
    const entries = bookEntries.map((id) => executions.find((entry) => entry.id === id)).filter((entry): entry is HanyuJinjieExecution => Boolean(entry));
    if (!bookMetadata.title.trim()) { setError('请填写书名'); return; }
    if (!entries.length) { setError('请至少选择一篇新解'); return; }
    setExporting(format); setError(null);
    try { if (format === 'epub') await exportEpub(bookMetadata, entries); else await exportPdf(bookMetadata, entries); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setExporting(null); }
  }, [bookEntries, bookMetadata, executions]);

  const handleGenerate = useCallback(async (nextWord?: string) => {
    const word = (nextWord ?? input).trim();
    if (!word || loading) return;
    if (word.length > MAX_WORD_LENGTH) { setError(`词汇请控制在 ${MAX_WORD_LENGTH} 个字符以内`); return; }
    if (!isDbReady()) { setError('本地数据库正在初始化，请稍后再试'); return; }
    if (!aiApi.apiKey?.trim() || !aiApi.baseUrl?.trim() || !aiApi.model?.trim()) {
      setError('请先在设置中完整配置 AI 服务、API Key 和模型'); return;
    }
    const requestId = ++requestIdRef.current;
    setInput(word); setLoading(true); setError(null); setCopied(false);
    try {
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `(汉语新解 "${lispString(word)}")` }];
      const raw = await llmChat(aiApi.apiKey, aiApi.baseUrl, aiApi.model, messages);
      const sanitized = sanitizeGeneratedSvg(raw);
      const detailedExplanation = extractExplanation(raw);
      if (!detailedExplanation) throw new Error('模型没有返回卡片详解，请重新生成');
      const executionId = await persistExecution({ word, status: 'success', svgContent: sanitized, explanation: detailedExplanation, error: '', model: aiApi.model });
      if (requestId !== requestIdRef.current) return;
      setSvgContent(sanitized); setExplanation(detailedExplanation); setGeneratedWord(word); setSelectedExecutionId(executionId);
    } catch (reason) {
      const message = errorMessage(reason);
      await persistExecution({ word, status: 'error', svgContent: '', explanation: '', error: message, model: aiApi.model });
      if (requestId === requestIdRef.current) setError(message);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [aiApi, input, loading, persistExecution]);

  const handleCopy = useCallback(async () => {
    if (!svgContent) return;
    try {
      await navigator.clipboard.writeText(svgContent);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch { setError('无法访问剪贴板，请使用下载功能保存 PNG 图片'); }
  }, [svgContent]);

  const handleDownload = useCallback(async () => {
    if (!svgContent) return;
    try {
      const url = URL.createObjectURL(await svgToPngBlob(svgContent));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `汉语新解-${safeCardFilename(generatedWord)}`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [generatedWord, svgContent]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><HanyuJinjie className="h-6 w-6" /></div>
          <div className="min-w-0"><h1 className="text-base font-semibold tracking-tight">汉语新解</h1><p className="truncate text-xs text-muted-foreground">用隐喻、翻译与视觉构成，重新解释一个当代词汇</p></div>
        </div>
        <div className="hidden max-w-52 truncate rounded-full border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground sm:block" title={aiApi.model || '未配置模型'}>{aiApi.model || '未配置模型'}</div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:overflow-hidden">
        <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-auto">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="text-sm font-medium">想解构哪个词？</h2></div>
            <textarea value={input} maxLength={MAX_WORD_LENGTH} rows={3} autoFocus
              onChange={(event) => { setInput(event.target.value); setError(null); }}
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void handleGenerate(); }}
              placeholder="例如：内卷、躺平、赋能……"
              className="w-full resize-none rounded-xl border bg-background px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>Ctrl / ⌘ + Enter 生成</span><span className={input.length >= MAX_WORD_LENGTH ? 'text-destructive' : ''}>{input.length}/{MAX_WORD_LENGTH}</span></div>
            <Button className="mt-4 w-full" disabled={loading || !input.trim()} onClick={() => void handleGenerate()}>
              {loading ? <Loader2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}{loading ? '正在解构…' : '生成新解卡片'}
            </Button>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="text-xs font-medium text-muted-foreground">试试这些词</h2>
            <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((word) => <button key={word} type="button" disabled={loading} onClick={() => { setInput(word); void handleGenerate(word); }} className="rounded-full border bg-background px-3 py-1.5 text-xs transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50">{word}</button>)}</div>
          </section>

          <section className="rounded-2xl border border-dashed bg-background/50 p-4 text-xs leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">生成说明</p><p className="mt-1">AI 会生成一张 400 × 600 卡片和 300 字以内的犀利详解，下载时自动转为高清 PNG。</p>
          </section>

          {executions.length > 0 && <section className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="text-xs font-medium">最近执行</h2><Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[11px]" onClick={openBookEditor}><BookOpen className="h-3.5 w-3.5" />新解成册</Button><span className="text-[10px] text-muted-foreground">SQLite</span></div>
            <div className="mt-3 space-y-1">{executions.slice(0, 10).map((execution) => <div key={execution.id} className={`group flex items-center rounded-lg transition hover:bg-accent ${selectedExecutionId === execution.id ? 'bg-primary/10' : ''}`}>
              <button type="button" onClick={() => { setInput(execution.word); setGeneratedWord(execution.word); setSvgContent(execution.svgContent || null); setExplanation(execution.explanation || ''); setError(execution.error || null); setSelectedExecutionId(execution.id); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${execution.status === 'success' ? 'bg-success' : 'bg-destructive'}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{execution.word}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(execution.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </button>
              <button type="button" title={`删除「${execution.word}」`} aria-label={`删除「${execution.word}」`} onClick={() => void handleDeleteExecution(execution.id)} className="mr-1 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>)}</div>
          </section>}
        </aside>

        <section className="relative flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm lg:min-h-0">
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="min-w-0"><h2 className="truncate text-sm font-medium">{generatedWord ? `「${generatedWord}」的新解` : '卡片预览'}</h2></div>
            {svgContent && <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" disabled={loading} onClick={() => void handleCopy()}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? '已复制' : '复制 SVG'}</Button>
              <Button variant="ghost" size="sm" disabled={loading} onClick={() => void handleDownload()}><Download className="h-3.5 w-3.5" />下载 PNG</Button>
              <Button variant="ghost" size="sm" disabled={loading} onClick={() => void handleGenerate(generatedWord)}><RefreshCw className="h-3.5 w-3.5" />重新生成</Button>
            </div>}
          </div>

          {error && <div role="alert" className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span>{input.trim() && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void handleGenerate()}>重试</Button>}</div>}

          <div className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_center,hsl(var(--muted))_1px,transparent_1px)] bg-[size:18px_18px] p-6">
            {svgContent ? <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center gap-5"><div className="flex w-full min-h-[28rem] justify-center [&>svg]:block [&>svg]:max-h-[720px] [&>svg]:w-auto [&>svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svgContent }} />{explanation && <article className="w-full rounded-2xl border bg-background/95 p-5 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">一针见血</h3><span className="text-[10px] text-muted-foreground">{explanation.length}/300 字</span></div><p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{explanation}</p></article>}</div> : !loading && <div className="flex min-h-full items-center justify-center"><div className="max-w-sm text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border bg-background text-primary shadow-sm"><HanyuJinjie className="h-11 w-11" /></div>
              <h2 className="mt-5 text-base font-medium">从一个词开始</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">输入一个当代词汇，生成包含中英日翻译、讽喻解释与抽象插图的卡片，并附一段直指本质的详解。</p>
            </div></div>}
            {loading && <div className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm"><div className="flex flex-col items-center gap-3"><Loader2 className="h-8 w-8 text-primary" /><p className="text-sm font-medium">正在解构「{input.trim()}」</p><p className="text-xs text-muted-foreground">组织隐喻、翻译与视觉构成…</p></div></div>}
          </div>
        </section>
      </main>

      {bookOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="新解成册">
        <section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
          <header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">新解成册</h2><p className="mt-1 text-xs text-muted-foreground">选择篇目、调整顺序并导出为电子书</p></div><button type="button" onClick={() => setBookOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">关闭</button></header>
          <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-5 md:grid-cols-[minmax(15rem,0.8fr)_minmax(18rem,1.2fr)]">
            <div className="space-y-4">
              <label className="grid gap-1.5 text-xs font-medium">书名<input value={bookMetadata.title} maxLength={60} onChange={(event) => setBookMetadata((value) => ({ ...value, title: event.target.value }))} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-primary" /></label>
              <label className="grid gap-1.5 text-xs font-medium">作者<input value={bookMetadata.author} maxLength={40} placeholder="选填" onChange={(event) => setBookMetadata((value) => ({ ...value, author: event.target.value }))} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-primary" /></label>
              <label className="grid gap-1.5 text-xs font-medium">简介<textarea value={bookMetadata.description} maxLength={200} rows={5} onChange={(event) => setBookMetadata((value) => ({ ...value, description: event.target.value }))} className="resize-none rounded-lg border bg-background p-3 text-sm font-normal leading-6 outline-none focus:border-primary" /><span className="text-right text-[10px] font-normal text-muted-foreground">{bookMetadata.description.length}/200</span></label>
              <div className="rounded-xl bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">PDF 使用 A5 版式，每篇包含卡片页与详解页；EPUB 会生成可跳转目录并自动适配阅读器。</div>
            </div>
            <div className="min-h-0"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">收录篇目与顺序</h3><span className="text-[10px] text-muted-foreground">已选 {bookEntries.length} 篇</span></div><div className="max-h-[26rem] space-y-1 overflow-auto rounded-xl border p-2">
              {[...executions].filter((entry) => entry.status === 'success' && entry.svgContent && entry.explanation).sort((a, b) => { const aIndex = bookEntries.indexOf(a.id); const bIndex = bookEntries.indexOf(b.id); if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex; if (aIndex >= 0) return -1; if (bIndex >= 0) return 1; return 0; }).map((entry) => { const selectedIndex = bookEntries.indexOf(entry.id); const selected = selectedIndex >= 0; return <div key={entry.id} className={`flex items-center gap-2 rounded-lg px-2 py-2 ${selected ? 'bg-primary/10' : 'hover:bg-accent'}`}><input type="checkbox" checked={selected} aria-label={`收录「${entry.word}」`} onChange={() => setBookEntries((current) => selected ? current.filter((id) => id !== entry.id) : [...current, entry.id])} className="h-4 w-4 accent-primary" /><span className="min-w-0 flex-1 truncate text-sm">{entry.word}</span>{selected && <><span className="w-5 text-center text-[10px] text-muted-foreground">{selectedIndex + 1}</span><button type="button" disabled={selectedIndex === 0} onClick={() => moveBookEntry(entry.id, -1)} className="rounded px-1.5 py-1 text-xs hover:bg-background disabled:opacity-25" aria-label="上移">↑</button><button type="button" disabled={selectedIndex === bookEntries.length - 1} onClick={() => moveBookEntry(entry.id, 1)} className="rounded px-1.5 py-1 text-xs hover:bg-background disabled:opacity-25" aria-label="下移">↓</button></>}</div>; })}
            </div></div>
          </div>
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4"><Button variant="outline" disabled={Boolean(exporting) || !bookEntries.length} onClick={() => void handleBookExport('epub')}>{exporting === 'epub' ? <Loader2 className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}导出 EPUB</Button><Button disabled={Boolean(exporting) || !bookEntries.length} onClick={() => void handleBookExport('pdf')}>{exporting === 'pdf' ? <Loader2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}导出 PDF</Button></footer>
        </section>
      </div>}
    </div>
  );
};
