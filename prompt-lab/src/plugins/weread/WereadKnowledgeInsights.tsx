import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, PieChart, SankeyChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { dbLoadWereadReviewStates, dbMarkWereadReviewed, flushDbToDisk, type WereadReviewState } from '@/db';

echarts.use([BarChart, HeatmapChart, PieChart, SankeyChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);
type JsonObject = Record<string, unknown>;
type AnalyticsBook = { bookId: string; title: string; author: string; noteCount: number; reviewCount: number; bookmarkCount: number; highlights: JsonObject[]; reviews: JsonObject[] };
type ThemePalette = { colors: string[]; text: string; muted: string; border: string; background: string; primaryLight: string; primaryStrong: string };
const STOP_WORDS = new Set(['一个', '一些', '这个', '那个', '这些', '我们', '自己', '什么', '为什么', '怎么', '可以', '不是', '没有', '就是', '因为', '所以', '但是', '如果', '已经', '还是', '以及', '对于', '通过', '进行', '这种', '一种', '可能', '需要', '应该', '非常', '作者', '书中']);

function objectOf(value: unknown): JsonObject { return value && typeof value === 'object' ? value as JsonObject : {}; }
function timestamp(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function reviewOf(item: JsonObject): JsonObject { return objectOf(item.review || item); }
function extractWords(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  const normalized = text.toLocaleLowerCase();
  const words = Segmenter ? [...new Segmenter('zh-CN', { granularity: 'word' }).segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment) : normalized.match(/[a-z][a-z0-9]{2,}|[\u4e00-\u9fff]{2,6}/g) || [];
  return words.map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}
function bookNotes(book: AnalyticsBook) {
  return [
    ...book.highlights.map((item) => ({ text: String(item.markText || ''), time: timestamp(item.createTime) })),
    ...book.reviews.map((item) => { const review = reviewOf(item); return { text: `${String(review.abstract || '')} ${String(review.content || '')}`, time: timestamp(review.createTime) }; }),
  ];
}

function Chart({ option, height = 360 }: { option: EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' }); chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={ref} className="w-full" style={{ height }} />;
}

function classify(text: string): string {
  if (/[?？]|为什么|如何|怎么|是否/.test(text)) return '问题';
  if (/计划|尝试|行动|以后|需要做到|下一步/.test(text)) return '行动';
  if (/不认同|不同意|未必|相反|质疑/.test(text)) return '反对';
  if (/同意|确实|认同|深有感触|赞同/.test(text)) return '认同';
  if (/想到|类似|让我想起|联想到|关联/.test(text)) return '联想';
  if (/本质|核心|关键|总结|归根结底/.test(text)) return '总结';
  return '其他';
}

export const WereadKnowledgeInsights: React.FC<{ books: AnalyticsBook[]; theme: ThemePalette; onSelectBook: (bookId: string) => void }> = ({ books, theme, onSelectBook }) => {
  const [chapterBookId, setChapterBookId] = useState(books[0]?.bookId || '');
  const [reviewStates, setReviewStates] = useState<WereadReviewState[]>([]);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => { try { setReviewStates(dbLoadWereadReviewStates()); } catch { setReviewStates([]); } }, []);
  useEffect(() => { if (!books.some((book) => book.bookId === chapterBookId)) setChapterBookId(books[0]?.bookId || ''); }, [books, chapterBookId]);
  const axis = { axisLabel: { color: theme.muted }, axisLine: { lineStyle: { color: theme.border } }, splitLine: { lineStyle: { color: theme.border } } };
  const base = { color: theme.colors, textStyle: { color: theme.text } };

  const data = useMemo(() => {
    const selected = books.find((book) => book.bookId === chapterBookId) || books[0];
    const chapters = new Map<string, { highlights: number; reviews: number }>();
    if (selected) {
      for (const item of selected.highlights) { const chapter = objectOf(item.chapter); const name = String(chapter.title || item.chapterTitle || '未分章节'); const value = chapters.get(name) || { highlights: 0, reviews: 0 }; value.highlights += 1; chapters.set(name, value); }
      for (const item of selected.reviews) { const review = reviewOf(item); const name = String(review.chapterName || '全书/未分章节'); const value = chapters.get(name) || { highlights: 0, reviews: 0 }; value.reviews += 1; chapters.set(name, value); }
    }
    const classifications = new Map<string, number>();
    for (const book of books) for (const item of book.reviews) { const review = reviewOf(item); const category = classify(String(review.content || '')); classifications.set(category, (classifications.get(category) || 0) + 1); }
    const authorLinks: Array<{ source: string; target: string; value: number }> = [];
    const nodeNames = new Set<string>();
    const topBooks = [...books].sort((a, b) => b.noteCount + b.reviewCount - a.noteCount - a.reviewCount).slice(0, 12);
    for (const book of topBooks) {
      const author = `作者：${book.author || '未知作者'}`; const bookName = `书籍：${book.title}`;
      nodeNames.add(author); nodeNames.add(bookName); authorLinks.push({ source: author, target: bookName, value: Math.max(1, book.noteCount + book.reviewCount) });
      const counts = new Map<string, number>(); for (const note of bookNotes(book)) for (const word of extractWords(note.text)) counts.set(word, (counts.get(word) || 0) + 1);
      for (const [word, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) { const topic = `主题：${word}`; nodeNames.add(topic); authorLinks.push({ source: bookName, target: topic, value: count }); }
    }
    const paths = books.map((book) => { const times = bookNotes(book).map((note) => note.time).filter(Boolean); return { book, start: times.length ? Math.min(...times) * 1000 : 0, end: times.length ? Math.max(...times) * 1000 : 0 }; }).filter((item) => item.start).sort((a, b) => a.start - b.start);
    return { selected, chapters: [...chapters.entries()], classifications: [...classifications.entries()], nodeNames: [...nodeNames], authorLinks, paths };
  }, [books, chapterBookId]);

  const chapterMax = Math.max(1, ...data.chapters.map(([, value]) => Math.max(value.highlights, value.reviews)));
  const chapterOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const value = (params as { value?: [number, number, number] }).value; return value ? `${data.chapters[value[0]]?.[0]}<br/>${['划线', '想法/点评'][value[1]]}：${value[2]} 条` : ''; } }, grid: { left: 90, right: 30, top: 20, bottom: 95 }, xAxis: { ...axis, type: 'category', data: data.chapters.map(([name]) => name), axisLabel: { color: theme.muted, rotate: 35, width: 90, overflow: 'truncate' }, splitArea: { show: true } }, yAxis: { ...axis, type: 'category', data: ['划线', '想法/点评'], splitArea: { show: true } }, visualMap: { min: 0, max: chapterMax, orient: 'horizontal', left: 'center', bottom: 5, textStyle: { color: theme.muted }, inRange: { color: [theme.primaryLight, theme.colors[0], theme.primaryStrong] } }, series: [{ type: 'heatmap', data: data.chapters.flatMap(([, value], x) => [[x, 0, value.highlights], [x, 1, value.reviews]]), label: { show: true, color: theme.text } }] };
  const classificationOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: theme.muted } }, series: [{ type: 'pie', radius: ['42%', '70%'], label: { color: theme.text, formatter: '{b}\n{c}' }, data: data.classifications.map(([name, value]) => ({ name, value })) }] };
  const sankeyOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'item' }, series: [{ type: 'sankey', data: data.nodeNames.map((name) => ({ name })), links: data.authorLinks, emphasis: { focus: 'adjacency' }, nodeGap: 10, nodeWidth: 16, lineStyle: { color: 'gradient', opacity: 0.35 }, label: { color: theme.text, fontSize: 11 } }] };
  const pathOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const item = (params as { data?: { title?: string; start?: number; end?: number } }).data; return item ? `${item.title}<br/>${new Date(item.start || 0).toLocaleDateString('zh-CN')} — ${new Date(item.end || 0).toLocaleDateString('zh-CN')}` : ''; } }, grid: { left: 125, right: 25, top: 20, bottom: 45 }, yAxis: { ...axis, type: 'category', inverse: true, data: data.paths.map(({ book }) => book.title), axisLabel: { color: theme.muted, width: 110, overflow: 'truncate' } }, xAxis: { ...axis, type: 'time' }, series: [{ type: 'bar', stack: 'path', silent: true, itemStyle: { color: 'transparent' }, data: data.paths.map((item) => item.start) }, { type: 'bar', stack: 'path', barWidth: 10, itemStyle: { color: theme.colors[0], borderRadius: 5 }, data: data.paths.map((item) => ({ value: Math.max(86_400_000, item.end - item.start), title: item.book.title, start: item.start, end: item.end })) }] };

  async function markReviewed(bookId: string, interval: number) {
    try { const state = dbMarkWereadReviewed(bookId, interval); setReviewStates((current) => [...current.filter((item) => item.bookId !== bookId), state]); await flushDbToDisk(); setReviewError(''); }
    catch { setReviewError('复习记录表尚未初始化，请完全退出应用后重新启动。'); }
  }
  const stateByBook = new Map(reviewStates.map((state) => [state.bookId, state]));

  return <div className="space-y-4">
    <div className="pt-2"><h2 className="text-lg font-semibold">知识与回顾</h2><p className="mt-1 text-sm text-muted-foreground">章节、观点类型、阅读路径和可操作的复习记录。</p></div>
    <section className="rounded-lg border bg-card p-3"><div className="flex items-center justify-between gap-3 px-2"><div><h3 className="text-sm font-medium">章节笔记热力图</h3><p className="mt-1 text-xs text-muted-foreground">比较一本书各章节的划线与想法密度。</p></div><select value={chapterBookId} onChange={(event) => setChapterBookId(event.target.value)} className="h-8 max-w-72 rounded-md border bg-background px-2 text-sm">{books.map((book) => <option key={book.bookId} value={book.bookId}>{book.title}</option>)}</select></div><Chart option={chapterOption} height={380} /></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">个人想法类型</h3><p className="px-2 pt-1 text-xs text-muted-foreground">使用本地规则识别问题、行动、认同、反对、联想与总结。</p><Chart option={classificationOption} /></section><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">阅读路径时间轴</h3><p className="px-2 pt-1 text-xs text-muted-foreground">从第一条到最后一条笔记的时间跨度。</p><Chart option={pathOption} height={Math.max(360, data.paths.length * 26)} /></section></div>
    <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">作者—书籍—主题</h3><p className="px-2 pt-1 text-xs text-muted-foreground">展示笔记量最多的书籍及其主要主题流向。</p><Chart option={sankeyOption} height={560} /></section>
    <section className="rounded-lg border bg-card p-4"><h3 className="text-sm font-medium">复习记录</h3><p className="mt-1 text-xs text-muted-foreground">完成复习后选择下一次间隔，记录会保存在本地 SQLite。</p>{reviewError && <p className="mt-2 text-sm text-destructive">{reviewError}</p>}<div className="mt-3 grid gap-2 md:grid-cols-2">{books.slice().sort((a, b) => b.noteCount + b.reviewCount - a.noteCount - a.reviewCount).slice(0, 12).map((book) => { const state = stateByBook.get(book.bookId); return <div key={book.bookId} className="rounded-md border bg-background p-3"><button className="block w-full truncate text-left text-sm font-medium hover:text-primary" onClick={() => onSelectBook(book.bookId)}>{book.title}</button><p className="mt-1 text-xs text-muted-foreground">{state ? `已复习 ${state.reviewCount} 次 · 下次 ${new Date(state.nextReviewAt).toLocaleDateString('zh-CN')}` : '尚未记录复习'}</p><div className="mt-2 flex gap-1"><span className="mr-1 self-center text-xs text-muted-foreground">完成并在</span>{[7, 30, 90].map((days) => <button key={days} onClick={() => void markReviewed(book.bookId, days)} className="rounded border px-2 py-1 text-xs hover:bg-accent">{days} 天后</button>)}</div></div>; })}</div></section>
  </div>;
};
