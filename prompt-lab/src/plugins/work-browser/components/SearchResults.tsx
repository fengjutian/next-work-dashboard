/**
 * SearchResults — 搜索结果弹层
 */
import { Empty, Spin, Drawer } from '../ui';
import { ArrowUpRight, Globe, BookMarked, BookOpen, CheckCircle2, CircleSlash2 } from 'lucide-react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';
import { AiSummaryCard } from './AiSummary';

export interface SearchResultsProps {
  open: boolean;
  onClose: () => void;
  data: AggregatedSearchResponse | null;
  loading: boolean;
  onOpen: (url: string) => void;
  onCancelSearch?: () => void;
  onRetryProvider?: (providerId: string) => void;
}

function sourceIcon(source: string) {
  if (source.includes('github')) return <BookMarked size={14} />;
  if (source.includes('stackoverflow')) return <BookOpen size={14} />;
  return <Globe size={14} />;
}

export function SearchResults({ open, onClose, data, loading, onOpen, onCancelSearch, onRetryProvider }: SearchResultsProps) {
  const availableProviders = data?.providers.filter((provider) => provider.ok && provider.count > 0) ?? [];
  const unavailableCount = data?.providers.filter((provider) => !provider.ok || provider.count === 0).length ?? 0;

  return (
    <Drawer
      title="搜索结果"
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
    >
      {loading && !data && <Spin tip="多引擎并行搜索中…" style={{ display: 'block', margin: '24px auto' }} />}
      {data && (
        <div className="space-y-4">
          {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spin size="small" />搜索引擎正在返回结果，列表会持续更新…<button type="button" className="ml-auto text-red-600 hover:underline" onClick={onCancelSearch}>取消</button></div>}
          {data.aiSummary && <AiSummaryCard summary={data.aiSummary} />}
          <div className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="font-medium text-foreground">{data.results.length} 条结果</span>
              <span className="text-muted-foreground">{data.took} ms</span>
              <span className="h-3 w-px bg-border" />
              {availableProviders.map((provider) => (
                <span key={provider.providerId} className="inline-flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  {provider.providerId} <span className="tabular-nums">{provider.count}</span>
                </span>
              ))}
              {unavailableCount > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground" title="未返回结果或暂不可用的搜索引擎">
                  <CircleSlash2 size={12} />{unavailableCount} 个未返回
                </span>
              )}
              {data.providers.filter((provider) => !provider.ok).map((provider) => <button key={`retry-${provider.providerId}`} type="button" className="text-primary hover:underline" onClick={() => onRetryProvider?.(provider.providerId)}>重试 {provider.providerId}</button>)}
            </div>
          </div>
          {data.results.length === 0 ? (
            <Empty description="没有命中" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
              {data.results.map((result, index) => (
                <button
                  key={`${result.canonicalUrl}:${result.source}`}
                  type="button"
                  onClick={() => onOpen(withTextFragment(result.url, data.query.text))}
                  className="group flex w-full gap-3 border-b border-border/50 px-4 py-3.5 text-left transition last:border-b-0 hover:bg-primary/[0.035] focus-visible:bg-primary/[0.05] focus-visible:outline-none"
                >
                  <span className="mt-0.5 w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">{index + 1}</span>
                  <span className="mt-0.5 shrink-0 text-muted-foreground">{sourceIcon(result.source)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="line-clamp-2 flex-1 text-sm font-semibold leading-5 text-primary group-hover:underline">{result.title}</span>
                      <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                    </span>
                    {result.snippet && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{result.snippet}</span>}
                    <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground/80">
                      <span className="shrink-0 font-medium text-foreground/65">{result.domain}</span>
                      {result.source !== result.domain && <span className="rounded-full bg-muted px-1.5 py-0.5">{result.source}</span>}
                      <span className="truncate">{compactUrl(result.canonicalUrl)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return value;
  }
}

function withTextFragment(value: string, query: string): string {
  const text = query.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!text) return value;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return value;
    const anchor = url.hash.slice(1).split(':~:text=')[0];
    url.hash = `${anchor ? `${anchor}:~:` : ':~:'}text=${encodeURIComponent(text)}`;
    return url.toString();
  } catch {
    return value;
  }
}
