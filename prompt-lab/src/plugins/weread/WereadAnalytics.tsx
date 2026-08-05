import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { WereadKnowledgeInsights } from './WereadKnowledgeInsights';
import { WereadInterestProfile } from './WereadInterestProfile';
import { WereadKnowledgeNetwork } from './WereadKnowledgeNetwork';
import { WereadInsightsActions } from './WereadInsightsActions';

echarts.use([
  BarChart, GraphChart, HeatmapChart, LineChart, PieChart, ScatterChart,
  CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer,
]);

type JsonObject = Record<string, unknown>;
export type AnalyticsBook = {
  bookId: string; title: string; author: string;
  noteCount: number; reviewCount: number; bookmarkCount: number;
  highlights: JsonObject[]; reviews: JsonObject[];
};
export type ThemePalette = { colors: string[]; text: string; muted: string; border: string; background: string; primaryLight: string; primaryStrong: string };
type NoteText = { text: string; timestamp: number };

const STOP_WORDS = new Set(['一个', '一些', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '自己', '什么', '为什么', '怎么', '可以', '不是', '没有', '就是', '因为', '所以', '但是', '如果', '已经', '还是', '以及', '而且', '对于', '通过', '进行', '这种', '一种', '可能', '需要', '应该', '非常', '这样', '作者', '书中', 'the', 'and', 'that', 'this', 'with', 'from', 'have']);

function timestampOf(value: unknown): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function noteTexts(book: AnalyticsBook): NoteText[] {
  const notes: NoteText[] = book.highlights.map((highlight) => ({ text: String(highlight.markText || ''), timestamp: timestampOf(highlight.createTime) }));
  for (const item of book.reviews) {
    const review = item.review && typeof item.review === 'object' ? item.review as JsonObject : item;
    notes.push({ text: `${String(review.abstract || '')} ${String(review.content || '')}`, timestamp: timestampOf(review.createTime) });
  }
  return notes;
}

export function extractWords(text: string): string[] {
  const normalized = text.toLocaleLowerCase();
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  const raw = Segmenter
    ? [...new Segmenter('zh-CN', { granularity: 'word' }).segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment)
    : normalized.match(/[a-z][a-z0-9]{2,}|[\u4e00-\u9fff]{2,6}/g) || [];
  return raw.map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function cssColor(style: CSSStyleDeclaration, name: string, alpha = 1): string {
  const [hue = '0', saturation = '0%', lightness = '0%'] = style.getPropertyValue(name).trim().split(/\s+/);
  return `hsla(${hue}, ${saturation}, ${lightness}, ${alpha})`;
}

function useThemePalette(): ThemePalette {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => {
    void revision;
    const style = getComputedStyle(document.documentElement);
    return {
      colors: [cssColor(style, '--primary', 0.72), cssColor(style, '--info', 0.72), cssColor(style, '--success', 0.72), cssColor(style, '--warning', 0.72), cssColor(style, '--primary-hover', 0.58)],
      text: cssColor(style, '--foreground'), muted: cssColor(style, '--muted-foreground'), border: cssColor(style, '--border'),
      background: cssColor(style, '--background'), primaryLight: cssColor(style, '--primary-muted', 0.72), primaryStrong: cssColor(style, '--primary-hover', 0.94),
    };
  }, [revision]);
}

function Chart({ option, height = 300, onClick }: { option: EChartsCoreOption; height?: number; onClick?: (params: unknown) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const chart: EChartsType = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    if (onClick) chart.on('click', onClick);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [onClick, option]);
  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

export const WereadAnalytics: React.FC<{ books: AnalyticsBook[]; onSelectBook: (bookId: string) => void }> = ({ books, onSelectBook }) => {
  const theme = useThemePalette();
  const [section, setSection] = useState<'overview' | 'habits' | 'topics' | 'interest' | 'network' | 'actions' | 'knowledge'>('overview');
  const [visited, setVisited] = useState<Set<typeof section>>(() => new Set(['overview']));

  function activateSection(next: typeof section) {
    setSection(next);
    if (!visited.has(next)) window.setTimeout(() => setVisited((current) => new Set(current).add(next)), 0);
  }
  const data = useMemo(() => {
    const days = new Map<string, { highlights: number; reviews: number }>();
    const words = new Map<string, number>();
    const monthlyWords = new Map<string, Map<string, number>>();
    const bookWords = new Map<string, Map<string, number>>();
    const wordPairs = new Map<string, number>();
    for (const book of books) {
      for (const highlight of book.highlights) {
        const timestamp = timestampOf(highlight.createTime);
        if (timestamp) { const key = dateKey(timestamp); const value = days.get(key) || { highlights: 0, reviews: 0 }; value.highlights += 1; days.set(key, value); }
      }
      for (const item of book.reviews) {
        const review = item.review && typeof item.review === 'object' ? item.review as JsonObject : item;
        const timestamp = timestampOf(review.createTime);
        if (timestamp) { const key = dateKey(timestamp); const value = days.get(key) || { highlights: 0, reviews: 0 }; value.reviews += 1; days.set(key, value); }
      }
      for (const note of noteTexts(book)) {
        const month = note.timestamp ? dateKey(note.timestamp).slice(0, 7) : '';
        const noteWords = extractWords(note.text);
        const perBook = bookWords.get(book.bookId) || new Map<string, number>();
        for (const word of noteWords) {
          words.set(word, (words.get(word) || 0) + 1);
          perBook.set(word, (perBook.get(word) || 0) + 1);
          if (month) { const counts = monthlyWords.get(month) || new Map<string, number>(); counts.set(word, (counts.get(word) || 0) + 1); monthlyWords.set(month, counts); }
        }
        bookWords.set(book.bookId, perBook);
        const unique = [...new Set(noteWords)].slice(0, 12);
        for (let left = 0; left < unique.length; left += 1) for (let right = left + 1; right < unique.length; right += 1) {
          const pair = [unique[left], unique[right]].sort().join('\u0000');
          wordPairs.set(pair, (wordPairs.get(pair) || 0) + 1);
        }
      }
    }
    const months = new Map<string, { highlights: number; reviews: number }>();
    for (const [day, value] of days) { const key = day.slice(0, 7); const month = months.get(key) || { highlights: 0, reviews: 0 }; month.highlights += value.highlights; month.reviews += value.reviews; months.set(key, month); }
    const ranking = [...books].sort((a, b) => (b.noteCount + b.reviewCount + b.bookmarkCount) - (a.noteCount + a.reviewCount + a.bookmarkCount)).slice(0, 12);
    const keywords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    const themeWords = keywords.slice(0, 5).map(([word]) => word);
    const reflection = books.filter((book) => book.noteCount + book.reviewCount > 0).map((book) => ({
      book, rate: book.noteCount ? Math.round((book.reviewCount / book.noteCount) * 100) : book.reviewCount ? 100 : 0,
    })).sort((a, b) => b.book.noteCount - a.book.noteCount);
    const reviewCandidates = reflection.filter(({ book, rate }) => book.noteCount >= 3 && rate < 30).slice(0, 6);
    const dayKeys = [...days.keys()].sort();
    let longestStreak = 0; let runningStreak = 0; let previousDay = 0;
    for (const key of dayKeys) {
      const currentDay = Math.floor(new Date(`${key}T00:00:00`).getTime() / 86_400_000);
      runningStreak = previousDay && currentDay === previousDay + 1 ? runningStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, runningStreak); previousDay = currentDay;
    }
    const todayDay = Math.floor(Date.now() / 86_400_000);
    let currentStreak = dayKeys.length && todayDay - previousDay <= 1 ? runningStreak : 0;
    if (!dayKeys.length) currentStreak = 0;
    const weekday = Array.from({ length: 7 }, () => 0);
    for (const [key, value] of days) weekday[(new Date(`${key}T00:00:00`).getDay() + 6) % 7] += value.highlights + value.reviews;
    const maxNotes = Math.max(1, ...books.map((book) => book.noteCount + book.reviewCount));
    const maxSpan = Math.max(1, ...books.map((book) => { const times = noteTexts(book).map((note) => note.timestamp).filter(Boolean); return times.length ? Math.max(...times) - Math.min(...times) : 0; }));
    const depth = books.map((book) => {
      const times = noteTexts(book).map((note) => note.timestamp).filter(Boolean);
      const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
      const volume = (book.noteCount + book.reviewCount) / maxNotes;
      const reflectionRate = Math.min(1, book.reviewCount / Math.max(1, book.noteCount));
      const continuity = span / maxSpan;
      return { book, score: Math.round((volume * 0.45 + reflectionRate * 0.35 + continuity * 0.2) * 100) };
    }).sort((a, b) => b.score - a.score).slice(0, 12);
    const similarityBooks = [...ranking].slice(0, 10);
    const vocabulary = keywords.slice(0, 40).map(([word]) => word);
    const vectors = new Map(similarityBooks.map((book) => [book.bookId, vocabulary.map((word) => bookWords.get(book.bookId)?.get(word) || 0)]));
    const cosine = (left: number[], right: number[]) => {
      const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
      const magnitude = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      return dot ? Math.round((dot / (magnitude(left) * magnitude(right))) * 100) : 0;
    };
    const similarities = similarityBooks.flatMap((left, y) => similarityBooks.map((right, x) => [x, y, left.bookId === right.bookId ? 100 : cosine(vectors.get(left.bookId) || [], vectors.get(right.bookId) || [])]));
    const pairLinks = [...wordPairs.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 35);
    const pairWords = new Set(pairLinks.flatMap(([pair]) => pair.split('\u0000')));
    const wordNodes = [...pairWords].map((word) => ({ name: word, value: words.get(word) || 1, symbolSize: 10 + Math.sqrt(words.get(word) || 1) * 3 }));
    const wordLinks = pairLinks.map(([pair, count]) => { const [source, target] = pair.split('\u0000'); return { source, target, value: count, lineStyle: { width: Math.min(6, 1 + count / 2) } }; });
    const nowSeconds = Date.now() / 1000;
    const reviewQueue = books.map((book) => {
      const times = noteTexts(book).map((note) => note.timestamp).filter(Boolean);
      const latest = times.length ? Math.max(...times) : 0;
      const ageDays = latest ? Math.floor((nowSeconds - latest) / 86_400) : 0;
      const interval = ageDays >= 180 ? 180 : ageDays >= 90 ? 90 : ageDays >= 30 ? 30 : ageDays >= 7 ? 7 : 1;
      const priority = Math.round(Math.log2(book.noteCount + book.reviewCount + 1) * 15 + Math.min(ageDays, 365) / 5 + (book.reviewCount ? 0 : 15));
      return { book, ageDays, interval, priority };
    }).filter((item) => item.ageDays >= item.interval).sort((a, b) => b.priority - a.priority).slice(0, 8);
    return { days, months, ranking, keywords, themeWords, monthlyWords, reflection, reviewCandidates, longestStreak, currentStreak, weekday, depth, similarityBooks, similarities, wordNodes, wordLinks, reviewQueue };
  }, [books]);

  const totals = useMemo(() => books.reduce((sum, book) => ({ highlights: sum.highlights + book.noteCount, reviews: sum.reviews + book.reviewCount, bookmarks: sum.bookmarks + book.bookmarkCount }), { highlights: 0, reviews: 0, bookmarks: 0 }), [books]);
  const monthKeys = [...data.months.keys()].sort();
  const wordMonthKeys = [...data.monthlyWords.keys()].sort();
  const maxDay = Math.max(1, ...[...data.days.values()].map((day) => day.highlights + day.reviews));
  const calendarYears = [...new Set([...data.days.keys()].map((day) => Number(day.slice(0, 4))))].sort((a, b) => a - b);
  if (!calendarYears.length) calendarYears.push(new Date().getFullYear());
  const topBook = data.ranking[0];
  const axis = { axisLabel: { color: theme.muted }, axisLine: { lineStyle: { color: theme.border } }, splitLine: { lineStyle: { color: theme.border } } };
  const base = { color: theme.colors, textStyle: { color: theme.text } };

  const trendOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, legend: { bottom: 0, textStyle: { color: theme.muted } }, grid: { left: 46, right: 20, top: 20, bottom: 55 }, xAxis: { ...axis, type: 'category', data: monthKeys }, yAxis: { ...axis, type: 'value', minInterval: 1 }, series: [{ name: '划线', type: 'line', smooth: true, data: monthKeys.map((key) => data.months.get(key)?.highlights || 0) }, { name: '想法/点评', type: 'line', smooth: true, data: monthKeys.map((key) => data.months.get(key)?.reviews || 0) }] };
  const rankingOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { bottom: 0, textStyle: { color: theme.muted } }, grid: { left: 110, right: 20, top: 15, bottom: 55 }, yAxis: { ...axis, type: 'category', inverse: true, data: data.ranking.map((book) => book.title), axisLabel: { color: theme.muted, width: 96, overflow: 'truncate' } }, xAxis: { ...axis, type: 'value', minInterval: 1 }, series: [{ name: '划线', type: 'bar', stack: 'notes', data: data.ranking.map((book) => ({ value: book.noteCount, bookId: book.bookId })) }, { name: '想法/点评', type: 'bar', stack: 'notes', data: data.ranking.map((book) => ({ value: book.reviewCount, bookId: book.bookId })) }, { name: '书签', type: 'bar', stack: 'notes', data: data.ranking.map((book) => ({ value: book.bookmarkCount, bookId: book.bookId })) }] };
  const pieOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: theme.muted } }, series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '45%'], label: { color: theme.text, formatter: '{b}\n{d}%' }, data: [{ name: '划线', value: totals.highlights }, { name: '想法/点评', value: totals.reviews }, { name: '书签', value: totals.bookmarks }] }] };
  const calendarOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const value = (params as { value?: [string, number] }).value; return value ? `${value[0]}：${value[1]} 条笔记` : ''; } }, visualMap: { min: 0, max: maxDay, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, textStyle: { color: theme.muted }, inRange: { color: [theme.primaryLight, theme.colors[0], theme.primaryStrong] } }, calendar: calendarYears.map((year, index) => ({ top: 35 + index * 145, left: 65, right: 20, range: String(year), cellSize: ['auto', 15], itemStyle: { color: theme.background, borderColor: theme.border }, splitLine: { lineStyle: { color: theme.border } }, yearLabel: { show: true, color: theme.text, margin: 34 }, dayLabel: { firstDay: 1, nameMap: 'ZH', color: theme.muted }, monthLabel: { nameMap: 'ZH', color: theme.muted } })), series: calendarYears.map((year, index) => ({ type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: index, data: [...data.days.entries()].filter(([day]) => Number(day.slice(0, 4)) === year).map(([day, value]) => [day, value.highlights + value.reviews]) })) };
  const keywordOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, grid: { left: 80, right: 20, top: 15, bottom: 30 }, yAxis: { ...axis, type: 'category', inverse: true, data: data.keywords.map(([word]) => word) }, xAxis: { ...axis, type: 'value', minInterval: 1 }, series: [{ name: '出现次数', type: 'bar', data: data.keywords.map(([, count]) => count), itemStyle: { color: theme.colors[0], borderRadius: [0, 4, 4, 0] } }] };
  const reflectionOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const value = (params as { data?: { value?: [number, number, number]; title?: string } }).data; return value?.value ? `${value.title}<br/>划线 ${value.value[0]} 条<br/>思考转化率 ${value.value[1]}%` : ''; } }, grid: { left: 50, right: 20, top: 20, bottom: 45 }, xAxis: { ...axis, name: '划线数', type: 'value', minInterval: 1, nameTextStyle: { color: theme.muted } }, yAxis: { ...axis, name: '转化率 %', type: 'value', max: (value: { max: number }) => Math.max(100, Math.ceil(value.max / 20) * 20), nameTextStyle: { color: theme.muted } }, series: [{ type: 'scatter', data: data.reflection.map(({ book, rate }) => ({ title: book.title, bookId: book.bookId, value: [book.noteCount, rate, book.reviewCount], symbolSize: Math.min(34, 10 + Math.sqrt(book.noteCount + book.reviewCount) * 3) })) }] };
  const topicTrendOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, legend: { bottom: 0, textStyle: { color: theme.muted } }, grid: { left: 45, right: 20, top: 20, bottom: 60 }, xAxis: { ...axis, type: 'category', data: wordMonthKeys }, yAxis: { ...axis, type: 'value', minInterval: 1 }, series: data.themeWords.map((word) => ({ name: word, type: 'line', smooth: true, data: wordMonthKeys.map((month) => data.monthlyWords.get(month)?.get(word) || 0) })) };
  const weekdayOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, grid: { left: 45, right: 20, top: 20, bottom: 35 }, xAxis: { ...axis, type: 'category', data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] }, yAxis: { ...axis, type: 'value', minInterval: 1 }, series: [{ type: 'bar', data: data.weekday, itemStyle: { color: theme.colors[0], borderRadius: [4, 4, 0, 0] } }] };
  const depthOption: EChartsCoreOption = { ...base, tooltip: { trigger: 'axis' }, grid: { left: 110, right: 35, top: 15, bottom: 30 }, yAxis: { ...axis, type: 'category', inverse: true, data: data.depth.map(({ book }) => book.title), axisLabel: { color: theme.muted, width: 96, overflow: 'truncate' } }, xAxis: { ...axis, type: 'value', max: 100 }, series: [{ type: 'bar', data: data.depth.map(({ book, score }) => ({ value: score, bookId: book.bookId })), label: { show: true, position: 'right', color: theme.muted }, itemStyle: { color: theme.colors[0], borderRadius: [0, 4, 4, 0] } }] };
  const similarityOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const value = (params as { value?: [number, number, number] }).value; return value ? `${data.similarityBooks[value[1]]?.title} × ${data.similarityBooks[value[0]]?.title}<br/>主题相似度：${value[2]}%` : ''; } }, grid: { left: 125, right: 25, top: 20, bottom: 105 }, xAxis: { ...axis, type: 'category', data: data.similarityBooks.map((book) => book.title), axisLabel: { color: theme.muted, rotate: 40, width: 90, overflow: 'truncate' }, splitArea: { show: true } }, yAxis: { ...axis, type: 'category', data: data.similarityBooks.map((book) => book.title), axisLabel: { color: theme.muted, width: 105, overflow: 'truncate' }, splitArea: { show: true } }, visualMap: { min: 0, max: 100, calculable: false, orient: 'horizontal', left: 'center', bottom: 8, textStyle: { color: theme.muted }, inRange: { color: [theme.primaryLight, theme.colors[0], theme.primaryStrong] } }, series: [{ type: 'heatmap', data: data.similarities, label: { show: true, color: theme.text, formatter: (params: unknown) => String((params as { value?: [number, number, number] }).value?.[2] || '') } }] };
  const relationOption: EChartsCoreOption = { ...base, tooltip: { formatter: (params: unknown) => { const item = params as { dataType?: string; name?: string; value?: number; data?: { source?: string; target?: string; value?: number } }; return item.dataType === 'edge' ? `${item.data?.source} ↔ ${item.data?.target}<br/>共同出现 ${item.data?.value} 次` : `${item.name}<br/>出现 ${item.value} 次`; } }, series: [{ type: 'graph', layout: 'force', roam: true, draggable: true, data: data.wordNodes, links: data.wordLinks, label: { show: true, color: theme.text }, itemStyle: { color: theme.colors[0] }, lineStyle: { color: theme.colors[1], opacity: 0.5, curveness: 0.08 }, emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.9 } }, force: { repulsion: 170, edgeLength: [65, 150], gravity: 0.08 } }] };

  if (!books.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先获取微信读书笔记，分析将基于本地 SQLite 缓存生成。</div>;
  const selectFromChart = (params: unknown) => { const bookId = String(((params as { data?: { bookId?: unknown } }).data?.bookId) || ''); if (bookId) onSelectBook(bookId); };

  return <div className="h-full overflow-auto bg-background/40">
    <div className="sticky top-0 z-20 border-b bg-background/95 px-5 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto">
        <div className="mr-auto shrink-0"><h2 className="text-base font-semibold">阅读分析</h2><p className="text-xs text-muted-foreground">本地 SQLite 数据分析</p></div>
        {([['overview', '数据概览'], ['habits', '习惯与深度'], ['topics', '主题关联'], ['interest', '兴趣画像'], ['network', '知识网络'], ['actions', '洞察与行动'], ['knowledge', '知识与复习']] as const).map(([id, label]) => <button key={id} onClick={() => activateSection(id)} className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors ${section === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>{label}</button>)}
      </div>
    </div>
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      {section === 'overview' && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['有笔记的书', `${books.length} 本`], ['笔记总数', `${totals.highlights + totals.reviews + totals.bookmarks} 条`], ['活跃天数', `${data.days.size} 天`], ['笔记最多', topBook?.title || '暂无']].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 truncate text-xl font-semibold" title={value}>{value}</p></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">每月笔记趋势</h3><Chart option={trendOption} /></section><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">笔记类型占比</h3><Chart option={pieOption} /></section></div>
        <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">笔记最多的书籍（点击查看笔记）</h3><Chart option={rankingOption} height={Math.max(320, data.ranking.length * 30)} onClick={selectFromChart} /></section>
        <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">全部笔记活跃日历</h3><Chart option={calendarOption} height={calendarYears.length * 145 + 80} /></section>
      </>}
      {section === 'habits' && <>
        <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">最长连续记录</p><p className="mt-2 text-2xl font-semibold text-primary">{data.longestStreak} 天</p></div><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">当前连续记录</p><p className="mt-2 text-2xl font-semibold text-primary">{data.currentStreak} 天</p></div><div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">最活跃星期</p><p className="mt-2 text-2xl font-semibold text-primary">{['周一', '周二', '周三', '周四', '周五', '周六', '周日'][data.weekday.indexOf(Math.max(...data.weekday))]}</p></div></div>
        <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">星期笔记习惯</h3><Chart option={weekdayOption} height={280} /></section>
        <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">思考转化率（点击查看笔记）</h3><p className="px-2 pt-1 text-xs text-muted-foreground">想法/点评数 ÷ 划线数；气泡大小代表笔记量。</p><Chart option={reflectionOption} height={365} onClick={selectFromChart} /></section>
        <section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">阅读深度综合评分（点击查看笔记）</h3><p className="px-2 pt-1 text-xs text-muted-foreground">综合笔记量 45%、思考转化率 35% 和记录时间跨度 20%。</p><Chart option={depthOption} height={Math.max(340, data.depth.length * 30)} onClick={selectFromChart} /></section>
        <section className="rounded-lg border bg-card p-4"><h3 className="text-sm font-medium">间隔复习建议</h3><div className="mt-3 grid gap-2 md:grid-cols-2">{data.reviewQueue.map(({ book, ageDays, interval, priority }) => <button key={book.bookId} onClick={() => onSelectBook(book.bookId)} className="rounded-md border bg-background p-3 text-left hover:bg-accent"><p className="truncate text-sm font-medium">{book.title}</p><p className="mt-1 text-xs text-muted-foreground">距最近笔记 {ageDays} 天 · {interval} 天间隔 · 优先级 {priority}</p></button>)}</div></section>
      </>}
      {section === 'topics' && <>
        <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">高频关键词</h3><Chart option={keywordOption} height={390} /></section><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">全部月份关注主题变化</h3><Chart option={topicTrendOption} height={390} /></section></div>
        <div className="grid gap-4 xl:grid-cols-2"><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">关键词共现关系</h3>{data.wordNodes.length ? <Chart option={relationOption} height={520} /> : <p className="py-20 text-center text-sm text-muted-foreground">暂无足够数据</p>}</section><section className="rounded-lg border bg-card p-3"><h3 className="px-2 text-sm font-medium">书籍主题相似度</h3><Chart option={similarityOption} height={520} /></section></div>
      </>}
      {(['interest', 'network', 'actions', 'knowledge'] as const).includes(section as 'interest') && !visited.has(section) && <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">正在准备分析数据…</div>}
      {visited.has('interest') && <div className={section === 'interest' ? 'block' : 'hidden'}><WereadInterestProfile books={books} theme={theme} /></div>}
      {visited.has('network') && <div className={section === 'network' ? 'block' : 'hidden'}><WereadKnowledgeNetwork books={books} theme={theme} onSelectBook={onSelectBook} /></div>}
      {visited.has('actions') && <div className={section === 'actions' ? 'block' : 'hidden'}><WereadInsightsActions books={books} theme={theme} onSelectBook={onSelectBook} /></div>}
      {visited.has('knowledge') && <div className={section === 'knowledge' ? 'block' : 'hidden'}><WereadKnowledgeInsights books={books} theme={theme} onSelectBook={onSelectBook} /></div>}
    </div>
  </div>;
};
