import { useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider } from '@/core/llm';
import { useStore } from '@/store/store';
import { normalizeWord } from './model';

interface ArticleResult { title: string; summary: string; paragraphs: Array<{ original: string; translation: string }> }

function parseArticle(raw: string): ArticleResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的文章翻译');
  const value = JSON.parse(fenced.slice(start, end + 1)) as Partial<ArticleResult>;
  const paragraphs = Array.isArray(value.paragraphs) ? value.paragraphs.filter((item) => item && typeof item.original === 'string' && typeof item.translation === 'string').slice(0, 100) : [];
  if (!paragraphs.length) throw new Error('翻译结果缺少段落');
  return { title: String(value.title || '文章阅读'), summary: String(value.summary || ''), paragraphs };
}

export function ArticleReader({ onLookup, speak }: { onLookup: (word: string, context: string) => void; speak: (text: string) => void }) {
  const aiApi = useStore((state) => state.aiApi);
  const [article, setArticle] = useState(''); const [result, setResult] = useState<ArticleResult | null>(null);
  const [layout, setLayout] = useState<'parallel' | 'english' | 'chinese'>('parallel'); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const wordCount = useMemo(() => article.trim() ? article.trim().split(/\s+/).length : 0, [article]);
  const translate = async () => {
    const input = article.trim(); setError('');
    if (!input) { setError('请粘贴英文文章'); return; }
    if (input.length > 30_000) { setError('文章不能超过 30000 个字符'); return; }
    if (!aiApi.apiKey?.trim() || !aiApi.baseUrl?.trim() || !aiApi.model?.trim()) { setError('请先在设置中配置 AI 服务'); return; }
    const controller = new AbortController(); abortRef.current = controller; setLoading(true);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, chatProxy: aiApi.provider === 'qwen' ? window.electronAPI.llmChat : undefined }); let raw = '';
      const prompt = 'Translate the English article into natural Chinese. Preserve paragraph boundaries. Return JSON only: {"title":"Chinese title","summary":"concise Chinese summary","paragraphs":[{"original":"exact English paragraph","translation":"Chinese translation"}]}. Do not omit content.';
      for await (const chunk of provider.chat([{ role: 'system', content: prompt }, { role: 'user', content: input }], { model: aiApi.model, temperature: 0.15, maxTokens: 8000, stream: true, signal: controller.signal })) raw += chunk.delta ?? '';
      setResult(parseArticle(raw));
    } catch (reason) { setError(reason instanceof DOMException && reason.name === 'AbortError' ? '翻译已取消' : reason instanceof Error ? reason.message : '文章翻译失败'); }
    finally { if (abortRef.current === controller) abortRef.current = null; setLoading(false); }
  };
  const lookupSelection = (text: string) => { const selected = window.getSelection()?.toString() ?? ''; const word = normalizeWord(selected); if (word && word.length <= 80) onLookup(word, text); };
  return <div className="mx-auto w-full max-w-[1500px] space-y-4"><section className="rounded-xl border bg-card p-4"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary"/><h2 className="font-semibold">文章翻译与阅读</h2><span className="ml-auto text-xs text-muted-foreground">{wordCount} 词 · {article.length}/30000 字符</span></div><textarea value={article} onChange={(event) => setArticle(event.target.value)} placeholder="粘贴英文文章，保留原始段落结构…" className="mt-4 min-h-48 w-full resize-y rounded-lg border bg-background p-3 text-sm leading-7 outline-none focus:ring-2 focus:ring-primary/30"/><div className="mt-3 flex justify-end gap-2">{loading && <Button variant="outline" onClick={() => abortRef.current?.abort()}>取消</Button>}<Button disabled={loading} onClick={() => void translate()}>{loading ? <Loader2 className="mr-2 h-4 w-4"/> : <Sparkles className="mr-2 h-4 w-4"/>}翻译文章</Button></div>{error && <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}</section>{result && <><section className="rounded-xl border bg-primary/5 p-4"><h1 className="text-xl font-semibold">{result.title}</h1>{result.summary && <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.summary}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant={layout === 'parallel' ? 'default' : 'outline'} onClick={() => setLayout('parallel')}>双语对照</Button><Button size="sm" variant={layout === 'english' ? 'default' : 'outline'} onClick={() => setLayout('english')}>仅英文</Button><Button size="sm" variant={layout === 'chinese' ? 'default' : 'outline'} onClick={() => setLayout('chinese')}>仅中文</Button></div></section><div className="space-y-3">{result.paragraphs.map((item, index) => <article key={index} className={`grid gap-4 rounded-xl border bg-card p-4 ${layout === 'parallel' ? 'lg:grid-cols-2' : ''}`}>{layout !== 'chinese' && <div onMouseUp={() => lookupSelection(item.original)}><div className="mb-2 flex items-center"><span className="text-[10px] text-muted-foreground">EN · 选中文字可查询</span><Button className="ml-auto" size="sm" variant="ghost" onClick={() => speak(item.original)}>朗读</Button></div><p className="select-text text-[15px] leading-8">{item.original}</p></div>}{layout !== 'english' && <div className={layout === 'parallel' ? 'border-t pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0' : ''}><span className="text-[10px] text-muted-foreground">中文</span><p className="mt-2 text-[15px] leading-8">{item.translation}</p></div>}</article>)}</div></>}</div>;
}

