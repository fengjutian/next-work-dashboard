import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { BookOpen, Languages, Loader2, Network, Search, Sparkles, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider } from '@/core/llm';
import { useStore } from '@/store/store';
import { buildVocabularyGraph, mergeEntry, normalizeWord, parseLookupResponse } from './model';
import { loadVocabulary, saveVocabulary } from './storage';
import type { WordEntry } from './types';

echarts.use([GraphChart, LegendComponent, TooltipComponent, CanvasRenderer]);

const SYSTEM_PROMPT = `You are an expert English lexicographer and language tutor. Return one valid JSON object only, with no markdown. Schema:
{"word":"lowercase headword","phonetic":"IPA","partOfSpeech":"concise parts of speech","definitions":[{"meaning":"clear Chinese definition","example":"natural English example","translation":"Chinese translation"}],"collocations":["common collocation"],"topics":["English topic"],"relations":[{"word":"English word","type":"synonym|antonym|related|word-family"}],"memoryTip":"concise Chinese learning tip"}.
Give 1-4 useful definitions, authentic examples, 3-8 collocations, 1-4 topics and 4-12 meaningful relations. Never invent a word. For an inflected form, explain it but use the queried form as word.`;

function Graph({ entries, onPick }: { entries: WordEntry[]; onPick: (word: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const graph = useMemo(() => buildVocabularyGraph(entries), [entries]);
  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { formatter: (params: unknown) => { const item = params as { dataType?: string; data?: { name?: string; value?: string } }; return item.dataType === 'edge' ? item.data?.value : item.data?.name; } },
    legend: { bottom: 0, data: ['单词本', '关联词', '主题'] },
    series: [{ type: 'graph', layout: 'force', roam: true, draggable: true, categories: [{ name: '单词本' }, { name: '关联词' }, { name: '主题' }], data: graph.nodes.map((node) => ({ ...node, category: node.category, itemStyle: node.saved ? { borderWidth: 3 } : undefined })), links: graph.links, edgeLabel: { show: true, formatter: '{c}', fontSize: 9 }, label: { show: true, position: 'right' }, lineStyle: { curveness: 0.08, opacity: 0.65 }, emphasis: { focus: 'adjacency' }, force: { repulsion: 220, edgeLength: [80, 150], gravity: 0.08 } }],
  }), [graph]);
  useEffect(() => { if (!ref.current) return; const chart: EChartsType = echarts.init(ref.current); chart.setOption(option); chart.on('click', (params: unknown) => { const item = params as { dataType?: string; data?: { id?: string; category?: number } }; if (item.dataType === 'node' && item.data?.category !== 2 && item.data.id) onPick(item.data.id); }); const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current); return () => { observer.disconnect(); chart.dispose(); }; }, [onPick, option]);
  return graph.nodes.length ? <div ref={ref} className="h-[620px] w-full" /> : <Empty text="把查询结果存入单词本后，关系图会在这里生长。" />;
}

function Empty({ text }: { text: string }) { return <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><Languages className="h-10 w-10 opacity-30"/><p>{text}</p></div>; }

export function EnglishLookupPanel() {
  const aiApi = useStore((state) => state.aiApi);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<WordEntry | null>(null);
  const [entries, setEntries] = useState<WordEntry[]>(loadVocabulary);
  const [tab, setTab] = useState<'lookup' | 'book' | 'graph'>('lookup');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => saveVocabulary(entries), [entries]);
  useEffect(() => { const openSearch = () => { setTab('lookup'); requestAnimationFrame(() => inputRef.current?.focus()); }; window.addEventListener('english-lookup:search', openSearch); return () => window.removeEventListener('english-lookup:search', openSearch); }, []);

  const lookup = useCallback(async (input = query) => {
    const word = normalizeWord(input); setError('');
    if (!word) { setError('请输入有效的英文单词或短语'); return; }
    if (!aiApi.apiKey?.trim() || !aiApi.baseUrl?.trim() || !aiApi.model?.trim()) { setError('请先在设置中配置 AI API Key、Base URL 和模型'); return; }
    setLoading(true);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, chatProxy: aiApi.provider === 'qwen' ? window.electronAPI.llmChat : undefined });
      const chunks: string[] = [];
      for await (const chunk of provider.chat([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Look up: ${word}` }], { model: aiApi.model, temperature: 0.2, maxTokens: 1800, stream: true })) if (chunk.delta) chunks.push(chunk.delta);
      setResult(parseLookupResponse(chunks.join(''), word)); setQuery(word); setTab('lookup');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败，请稍后重试'); } finally { setLoading(false); }
  }, [aiApi, query]);

  const save = () => { if (!result) return; setEntries((current) => [mergeEntry(current.find((item) => item.word === result.word), result), ...current.filter((item) => item.word !== result.word)]); };
  const selectWord = useCallback((word: string) => { const saved = entries.find((item) => item.word === word); if (saved) { setResult(saved); setQuery(saved.word); setTab('lookup'); } else { setQuery(word); void lookup(word); } }, [entries, lookup]);
  const saved = result ? entries.some((item) => item.word === result.word) : false;

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="border-b px-6 py-5"><div className="mx-auto flex max-w-6xl items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Languages className="h-6 w-6"/></div><div><h1 className="text-lg font-semibold">AI 英语查询</h1><p className="text-xs text-muted-foreground">释义、例句、搭配与词汇关系，一次查清</p></div><div className="ml-auto flex rounded-lg border bg-muted/30 p-1">{([['lookup','查询',Search],['book',`单词本 ${entries.length}`,BookOpen],['graph','知识图谱',Network]] as const).map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${tab === id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}><Icon className="h-3.5 w-3.5"/>{label}</button>)}</div></div></header>
    <main className="min-h-0 flex-1 overflow-auto p-6"><div className="mx-auto max-w-6xl">
      {tab === 'lookup' && <><form onSubmit={(event) => { event.preventDefault(); void lookup(); }} className="mx-auto flex max-w-3xl gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><input ref={inputRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入英文单词或短语，例如 serendipity" className="h-10 w-full rounded-lg border bg-card pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"/></div><Button disabled={loading} type="submit">{loading ? <Loader2 className="mr-2 h-4 w-4"/> : <Sparkles className="mr-2 h-4 w-4"/>}AI 查询</Button></form>{error && <p role="alert" className="mx-auto mt-3 max-w-3xl rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{result ? <article className="mx-auto mt-6 max-w-3xl space-y-4"><section className="rounded-xl border bg-card p-6 shadow-sm"><div className="flex items-start"><div><h2 className="text-3xl font-semibold tracking-tight">{result.word}</h2><p className="mt-1 text-sm text-muted-foreground">{result.phonetic} {result.partOfSpeech && `· ${result.partOfSpeech}`}</p></div><Button className="ml-auto" variant={saved ? 'outline' : 'default'} onClick={save}><BookOpen className="mr-2 h-4 w-4"/>{saved ? '更新单词本' : '存入单词本'}</Button></div><div className="mt-6 space-y-5">{result.definitions.map((item,index) => <div key={`${item.meaning}-${index}`}><p className="font-medium"><span className="mr-2 text-primary">{index + 1}.</span>{item.meaning}</p>{item.example && <p className="mt-2 border-l-2 border-primary/30 pl-3 text-sm italic">{item.example}</p>}{item.translation && <p className="mt-1 pl-3 text-xs text-muted-foreground">{item.translation}</p>}</div>)}</div></section><div className="grid gap-4 md:grid-cols-2"><section className="rounded-xl border bg-card p-5"><h3 className="text-sm font-semibold">常用搭配</h3><div className="mt-3 flex flex-wrap gap-2">{result.collocations.map((item) => <span key={item} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{item}</span>)}</div></section><section className="rounded-xl border bg-card p-5"><h3 className="text-sm font-semibold">关联词汇</h3><div className="mt-3 flex flex-wrap gap-2">{result.relations.map((item) => <button key={`${item.type}-${item.word}`} onClick={() => selectWord(item.word)} className="rounded-md border px-2.5 py-1 text-left text-xs hover:bg-accent"><b>{item.word}</b><span className="ml-1 text-muted-foreground">{item.type}</span></button>)}</div></section></div>{result.memoryTip && <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><b>记忆提示：</b>{result.memoryTip}</section>}</article> : !loading && <Empty text="输入一个单词，让 AI 为你生成结构化词典卡片。"/>}</>}
      {tab === 'book' && (entries.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => <article key={entry.id} className="rounded-xl border bg-card p-4"><button onClick={() => selectWord(entry.word)} className="w-full text-left"><h2 className="text-xl font-semibold">{entry.word}</h2><p className="mt-1 text-xs text-muted-foreground">{entry.phonetic} · {entry.partOfSpeech}</p><p className="mt-3 line-clamp-2 text-sm">{entry.definitions[0]?.meaning}</p></button><div className="mt-4 flex items-center border-t pt-3"><span className="text-[10px] text-muted-foreground">{entry.relations.length} 个关联词</span><button aria-label={`删除 ${entry.word}`} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4"/></button></div></article>)}</div> : <Empty text="单词本还是空的，先查询并收藏一个单词吧。"/>)}
      {tab === 'graph' && <section className="rounded-xl border bg-card p-3"><Graph entries={entries} onPick={selectWord}/></section>}
    </div></main>
  </div>;
}
