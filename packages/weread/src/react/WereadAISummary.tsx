import React, { memo, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from './Button';
import { useWereadAdapter } from './context';
import type { WereadSummaryItem } from './adapter';
import type { AnalyticsBook } from './WereadAnalytics';

export const WereadAISummary = memo(function WereadAISummary({ books }: { books: AnalyticsBook[] }) {
  const { ai: aiApi, api } = useWereadAdapter();
  const [summaries, setSummaries] = useState<WereadSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);

  const topBooks = useMemo(() =>
    [...books].sort((a, b) => b.noteCount + b.reviewCount - a.noteCount - a.reviewCount).slice(0, 10),
  [books]);

  async function generateSummaries() {
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) {
      setError('请先在设置中配置 AI API（设置 → AI API，需填写 API Key、Base URL 和 Model）');
      return;
    }
    setLoading(true); setError(''); setSummaries([]);
    try {
      const payload = {
        baseUrl: aiApi.baseUrl,
        apiKey: aiApi.apiKey,
        model: aiApi.model,
        books: topBooks.map((book) => ({
          bookId: book.bookId,
          title: book.title,
          author: book.author,
          highlights: book.highlights.map((h) => String((h as Record<string, unknown>).markText || '').trim()).filter(Boolean).slice(0, 15),
          reviews: book.reviews.map((r) => {
            const review = (r.review && typeof r.review === 'object' ? r.review : r) as Record<string, unknown>;
            return String(review.content || '').trim();
          }).filter(Boolean).slice(0, 8),
        })),
      };
      const result = await api.wereadAiSummary(payload);
      if (!result.success) throw new Error(result.error || 'AI 摘要生成失败');
      setSummaries(result.summaries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }

  const summaryByBook = new Map(summaries.map((s) => [s.bookId, s]));
  if (!books.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先获取微信读书笔记。</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">AI 智能摘要</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            使用 AI 为笔记最多的 10 本书自动生成摘要和标签。需要先在设置中配置 AI API。
          </p>
        </div>
        <Button onClick={() => void generateSummaries()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? '生成中…' : summaries.length ? '重新生成' : '生成摘要'}
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {summaries.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {topBooks.filter((book) => summaryByBook.has(book.bookId)).map((book) => {
            const info = summaryByBook.get(book.bookId)!;
            const isOpen = expandedBookId === book.bookId;
            return (
              <div key={book.bookId} className="rounded-lg border bg-card p-4">
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedBookId(isOpen ? null : book.bookId)}
                >
                  <h3 className="font-medium hover:text-primary">{book.title}</h3>
                  <p className="text-xs text-muted-foreground">{book.author || '未知作者'} · {book.highlights.length} 条划线 · {book.reviews.length} 条想法</p>
                </button>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {info.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      #{tag}
                    </span>
                  ))}
                </div>

                <p className={`mt-2 text-sm leading-relaxed text-muted-foreground ${isOpen ? '' : 'line-clamp-3'}`}>
                  {info.summary}
                </p>

                {isOpen && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">书籍原文摘录</p>
                    <div className="mt-2 space-y-1.5">
                      {book.highlights.slice(0, 5).map((h, i) => (
                        <blockquote key={i} className="border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">
                          {String((h as Record<string, unknown>).markText || '')}
                        </blockquote>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!summaries.length && !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">点击"生成摘要"，AI 将为你的阅读笔记生成智能摘要和标签</p>
          <p className="text-xs text-muted-foreground">使用 DeepSeek / OpenAI 兼容 API，数据仅在本地处理后发送</p>
        </div>
      )}
    </div>
  );
});
