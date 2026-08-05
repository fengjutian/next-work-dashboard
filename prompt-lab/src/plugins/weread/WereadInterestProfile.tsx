import { memo, useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, SankeyChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import type { AnalyticsBook, ThemePalette } from './WereadAnalytics';

echarts.use([BarChart, HeatmapChart, LineChart, PieChart, SankeyChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);
type JsonObject = Record<string, unknown>;
type TextNote = { text: string; time: number; author: string };
const STOP_WORDS = new Set(['一个', '一些', '这个', '那个', '这些', '我们', '自己', '什么', '为什么', '怎么', '可以', '不是', '没有', '就是', '因为', '所以', '但是', '如果', '已经', '还是', '以及', '对于', '通过', '进行', '这种', '一种', '可能', '需要', '应该', '非常', '作者', '书中']);

function wordsOf(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  const normalized = text.toLocaleLowerCase();
  const words = Segmenter ? [...new Segmenter('zh-CN', { granularity: 'word' }).segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment) : normalized.match(/[a-z][a-z0-9]{2,}|[\u4e00-\u9fff]{2,6}/g) || [];
  return words.map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}
function timestamp(value: unknown): number { const result = Number(value); return Number.isFinite(result) && result > 0 ? result : 0; }
function reviewOf(item: JsonObject): JsonObject { return item.review && typeof item.review === 'object' ? item.review as JsonObject : item; }
function notesOf(book: AnalyticsBook): TextNote[] {
  return [...book.highlights.map((item) => ({ text: String(item.markText || ''), time: timestamp(item.createTime), author: book.author || '未知作者' })), ...book.reviews.map((item) => { const review = reviewOf(item); return { text: `${String(review.abstract || '')} ${String(review.content || '')}`, time: timestamp(review.createTime), author: book.author || '未知作者' }; })];
}
function monthOf(time: number): string { const date = new Date(time * 1000); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function countWords(notes: TextNote[]): Map<string, number> { const counts = new Map<string, number>(); for (const note of notes) for (const word of wordsOf(note.text)) counts.set(word, (counts.get(word) || 0) + 1); return counts; }
function topEntries(counts: Map<string, number>, limit: number) { return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit); }

function Chart({ option, height = 360 }: { option: EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!ref.current) return; const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' }); chart.setOption(option); const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current); return () => { observer.disconnect(); chart.dispose(); }; }, [option]);
  return <div ref={ref} className="w-full" style={{ height }} />;
}

export const WereadInterestProfile = memo(function WereadInterestProfile({ books, theme }: { books: AnalyticsBook[]; theme: ThemePalette }) {
  const data = useMemo(() => {
    const notes = books.flatMap(notesOf).filter((note) => note.text.trim());
    const latest = Math.max(0, ...notes.map((note) => note.time));
    const recentStart = latest - 90 * 86_400; const previousStart = latest - 180 * 86_400;
    const recent = countWords(notes.filter((note) => note.time >= recentStart));
    const previous = countWords(notes.filter((note) => note.time >= previousStart && note.time < recentStart));
    const all = countWords(notes);
    const total = [...all.values()].reduce((sum, value) => sum + value, 0);
    const probabilities = [...all.values()].map((value) => value / Math.max(1, total));
    const concentration = Math.round(probabilities.reduce((sum, value) => sum + value * value, 0) * 1000) / 10;
    const entropy = -probabilities.reduce((sum, value) => sum + (value ? value * Math.log(value) : 0), 0);
    const diversity = Math.round((entropy / Math.max(1, Math.log(probabilities.length))) * 100);
    const allTopics = new Set([...recent.keys(), ...previous.keys()]);
    const topicStatus = { emerging: [] as Array<[string, number]>, persistent: [] as Array<[string, number]>, declining: [] as Array<[string, number]> };
    for (const word of allTopics) { const now = recent.get(word) || 0; const before = previous.get(word) || 0; if (now >= 2 && before === 0) topicStatus.emerging.push([word, now]); else if (now > 0 && before > 0) topicStatus.persistent.push([word, now + before]); else if (before >= 2 && now < before * 0.5) topicStatus.declining.push([word, before]); }
    for (const list of Object.values(topicStatus)) list.sort((a, b) => b[1] - a[1]).splice(10);
    const authorCounts = new Map<string, number>(); const authorWords = new Map<string, Map<string, number>>();
    for (const note of notes) { const words = wordsOf(note.text); authorCounts.set(note.author, (authorCounts.get(note.author) || 0) + 1); const counts = authorWords.get(note.author) || new Map<string, number>(); for (const word of words) counts.set(word, (counts.get(word) || 0) + 1); authorWords.set(note.author, counts); }
    const authors = topEntries(authorCounts, 10).map(([author]) => author); const topics = topEntries(all, 10).map(([word]) => word);
    const authorTopicMatrix = authors.flatMap((author, y) => topics.map((topic, x) => [x, y, authorWords.get(author)?.get(topic) || 0]));
    const monthNotes = new Map<string, TextNote[]>(); for (const note of notes) if (note.time) { const month = monthOf(note.time); monthNotes.set(month, [...(monthNotes.get(month) || []), note]); }
    const months = [...monthNotes.keys()].sort(); const dominant = months.map((month) => ({ month, topic: topEntries(countWords(monthNotes.get(month) || []), 1)[0]?.[0] || '无主题' }));
    const migrationTopics = [...new Set(dominant.map((item) => item.topic))];
    const sankeyLinks: Array<{ source: string; target: string; value: number }> = []; const sankeyNodes = new Set<string>();
    const focusAuthors = new Set(authors.slice(0, 6)); const focusTopics = new Set(topics.slice(0, 8));
    for (const [month, items] of monthNotes) { const monthNode = `月份：${month}`; sankeyNodes.add(monthNode); const perAuthor = new Map<string, number>(); for (const note of items) if (focusAuthors.has(note.author)) perAuthor.set(note.author, (perAuthor.get(note.author) || 0) + 1); for (const [author, value] of perAuthor) { const authorNode = `作者：${author}`; sankeyNodes.add(authorNode); sankeyLinks.push({ source: monthNode, target: authorNode, value }); } }
    for (const author of focusAuthors) for (const topic of focusTopics) { const value = authorWords.get(author)?.get(topic) || 0; if (value) { const authorNode = `作者：${author}`; const topicNode = `主题：${topic}`; sankeyNodes.add(authorNode); sankeyNodes.add(topicNode); sankeyLinks.push({ source: authorNode, target: topicNode, value }); } }
    return { latest, recent, previous, all, concentration, diversity, topicStatus, authorCounts, authors, topics, authorTopicMatrix, months, dominant, migrationTopics, sankeyNodes: [...sankeyNodes], sankeyLinks };
  }, [books]);
  const axis = { axisLabel: { color: theme.muted }, axisLine: { lineStyle: { color: theme.border } }, splitLine: { lineStyle: { color: theme.border } } };
  const base = { color: theme.colors, textStyle: { color: theme.text } };
  const longTerm = topEntries(data.all, 10); const shortTerm = topEntries(data.recent, 10);
  const interestOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: theme.muted } }, series: [{ name: '长期兴趣', type: 'pie', radius: [25, 82], center: ['28%', '46%'], roseType: 'radius', label: { color: theme.text, formatter: '{b}' }, data: longTerm.map(([name, value]) => ({ name, value })) }, { name: '短期兴趣', type: 'pie', radius: [25, 82], center: ['72%', '46%'], roseType: 'radius', label: { color: theme.text, formatter: '{b}' }, data: shortTerm.map(([name, value]) => ({ name, value })) }] };
  const authorOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, grid: { left: 105, right: 25, top: 15, bottom: 30 }, yAxis: { ...axis, type: 'category', inverse: true, data: data.authors }, xAxis: { ...axis, type: 'value', minInterval: 1 }, series: [{ type: 'bar', data: data.authors.map((author) => data.authorCounts.get(author) || 0), itemStyle: { color: theme.colors[0], borderRadius: [0, 4, 4, 0] } }] };
  const matrixMax = Math.max(1, ...data.authorTopicMatrix.map((item) => item[2]));
  const matrixOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const value = (params as { value?: [number, number, number] }).value; return value ? `${data.authors[value[1]]} × ${data.topics[value[0]]}<br/>出现 ${value[2]} 次` : ''; } }, grid: { left: 110, right: 25, top: 20, bottom: 95 }, xAxis: { ...axis, type: 'category', data: data.topics, axisLabel: { color: theme.muted, rotate: 35 } }, yAxis: { ...axis, type: 'category', data: data.authors }, visualMap: { min: 0, max: matrixMax, orient: 'horizontal', left: 'center', bottom: 5, textStyle: { color: theme.muted }, inRange: { color: [theme.primaryLight, theme.colors[0], theme.primaryStrong] } }, series: [{ type: 'heatmap', data: data.authorTopicMatrix, label: { show: true, color: theme.text } }] };
  const evolutionOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'item' }, series: [{ type: 'sankey', data: data.sankeyNodes.map((name) => ({ name })), links: data.sankeyLinks, nodeWidth: 14, nodeGap: 9, lineStyle: { color: 'gradient', opacity: 0.3 }, label: { color: theme.text, fontSize: 10 }, emphasis: { focus: 'adjacency' } }] };
  const migrationOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, grid: { left: 90, right: 25, top: 25, bottom: 55 }, xAxis: { ...axis, type: 'category', data: data.months, axisLabel: { color: theme.muted, rotate: 35 } }, yAxis: { ...axis, type: 'category', data: data.migrationTopics }, series: [{ type: 'line', step: 'middle', symbolSize: 9, data: data.dominant.map((item) => data.migrationTopics.indexOf(item.topic)), lineStyle: { width: 3, color: theme.colors[0] }, itemStyle: { color: theme.primaryStrong } }] };
  const statusGroups = [['新出现', data.topicStatus.emerging], ['持续关注', data.topicStatus.persistent], ['正在衰退', data.topicStatus.declining]] as const;

  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">兴趣画像</h2><p className="mt-1 text-sm text-muted-foreground">短期窗口以最新笔记为基准回溯 90 天，避免历史缓存造成误判。</p></div>
    <div className="grid gap-3 md:grid-cols-3"><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">主题集中度</p><p className="mt-2 text-2xl font-semibold text-primary">{data.concentration}%</p><p className="mt-1 text-xs text-muted-foreground">越高表示关注集中在少数主题</p></div><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">主题多样性指数</p><p className="mt-2 text-2xl font-semibold text-primary">{data.diversity}</p><p className="mt-1 text-xs text-muted-foreground">0–100，越高表示兴趣范围越丰富</p></div><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">画像基准日期</p><p className="mt-2 text-xl font-semibold">{data.latest ? new Date(data.latest * 1000).toLocaleDateString('zh-CN') : '暂无'}</p></div></div>
    <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">长期兴趣与短期兴趣</h3><Chart option={interestOption} height={390} /></section>
    <div className="grid gap-3 lg:grid-cols-3">{statusGroups.map(([label, entries]) => <section key={label} className="rounded-lg border bg-card p-4"><h3 className="text-sm font-medium">{label}的主题</h3><div className="mt-3 flex flex-wrap gap-2">{entries.map(([word, count]) => <span key={word} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{word} · {count}</span>)}{!entries.length && <span className="text-xs text-muted-foreground">暂无明显主题</span>}</div></section>)}</div>
    <div className="grid gap-4 xl:grid-cols-2"><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">作者偏好</h3><p className="px-2 pt-1 text-xs text-muted-foreground">按产生笔记的数量排序。</p><Chart option={authorOption} height={380} /></section><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">同一主题下最常阅读的作者</h3><Chart option={matrixOption} height={420} /></section></div>
    <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">主题—作者—时间演化</h3><p className="px-2 pt-1 text-xs text-muted-foreground">月份流向作者，再流向作者笔记中的主要主题。</p><Chart option={evolutionOption} height={580} /></section>
    <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">兴趣迁移路径</h3><p className="px-2 pt-1 text-xs text-muted-foreground">展示每个月最突出的主题及其变化轨迹。</p><Chart option={migrationOption} height={390} /></section>
  </div>;
});
