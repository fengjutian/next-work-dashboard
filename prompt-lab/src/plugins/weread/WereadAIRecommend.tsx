import React, { memo, useMemo, useState } from 'react';
import { BookOpen, Loader2, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import type { AnalyticsBook } from './WereadAnalytics';

type RecommendItem = { type: 'same_author' | 'similar' | 'opposite'; title: string; author: string; reason: string };

const TYPE_LABEL: Record<string, { label: string; desc: string; color: string }> = {
  same_author: { label: '同作者作品', desc: '你关注的作者还有哪些值得读的作品', color: 'border-blue-400/60 bg-blue-50 dark:bg-blue-950/30' },
  similar: { label: '主题相近', desc: '与你的阅读兴趣高度相关的书籍', color: 'border-green-400/60 bg-green-50 dark:bg-green-950/30' },
  opposite: { label: '反向视角', desc: '相反立场或对立观点，拓展思维边界', color: 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/30' },
};

export const WereadAIRecommend = memo(function WereadAIRecommend({ books }: { books: AnalyticsBook[] }) {
  const aiApi = useStore((s) => s.aiApi);
  const [recommendations, setRecommendations] = useState<RecommendItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const digest = useMemo(() => {
    const sorted = [...books].sort((a, b) => b.noteCount + b.reviewCount - a.noteCount - a.reviewCount);
    const top15 = sorted.slice(0, 15);
    const topIds = new Set(top15.map((b) => b.bookId));
    // 全部书籍（标题+作者）用于推荐上下文，笔记最活跃的 15 本附带划线/想法作为阅读品味样本
    // 上限 60 本避免 payload 过大
    return sorted.slice(0, 60).map((book) => ({
      title: book.title,
      author: book.author,
      highlights: topIds.has(book.bookId)
        ? book.highlights.map((h) => String((h as Record<string, unknown>).markText || '').trim()).filter(Boolean).slice(0, 10)
        : [],
      reviews: topIds.has(book.bookId)
        ? book.reviews.map((r) => {
            const review = (r.review && typeof r.review === 'object' ? r.review : r) as Record<string, unknown>;
            return String(review.content || '').trim();
          }).filter(Boolean).slice(0, 5)
        : [],
    }));
  }, [books]);

  const grouped = useMemo(() => {
    const groups: Record<string, RecommendItem[]> = { same_author: [], similar: [], opposite: [] };
    for (const item of recommendations) groups[item.type]?.push(item);
    return groups;
  }, [recommendations]);

  async function generate() {
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setError('请先在设置中配置 AI API（需填写 API Key、Base URL 和 Model）'); return; }
    setLoading(true); setError(''); setRecommendations([]);
    try {
      const result = await window.electronAPI.wereadAiRecommend({ baseUrl: aiApi.baseUrl, apiKey: aiApi.apiKey, model: aiApi.model, books: digest });
      if (!result.success) throw new Error(result.error || 'AI 推荐生成失败');
      setRecommendations(result.recommendations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }

  if (!books.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先获取微信读书笔记。</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">AI 智能推荐</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            基于你的全部阅读历史（{books.length} 本书，{digest.length < books.length ? `取前 ${digest.length} 本，` : ''}{new Set(digest.map((b) => b.author).filter(Boolean)).size} 位作者），AI 从三个维度推荐书籍。
          </p>
        </div>
        <Button onClick={() => void generate()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? '分析中…' : recommendations.length ? '刷新推荐' : '生成推荐'}
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {recommendations.length > 0 ? (
        <div className="space-y-5">
          {(['same_author', 'similar', 'opposite'] as const).map((type) => {
            const items = grouped[type];
            if (!items.length) return null;
            const meta = TYPE_LABEL[type];
            return (
              <section key={type}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h3 className="text-base font-semibold">{meta.label}</h3>
                  <span className="text-xs text-muted-foreground">{meta.desc}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item, i) => (
                    <div key={i} className={`rounded-lg border-l-4 p-4 ${meta.color}`}>
                      <h4 className="font-medium">{item.title}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.author}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">点击"生成推荐"，AI 将分析你的阅读偏好并推荐书籍</p>
          <p className="text-xs text-muted-foreground">基于全部阅读历史和所有作者，从同作者、主题相近、反向视角三个维度推荐</p>
        </div>
      )}
    </div>
  );
});
