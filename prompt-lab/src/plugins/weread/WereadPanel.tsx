import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Download, Eye, EyeOff, Loader2, RefreshCw, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dbLoadWereadCache, dbReplaceWereadCache, flushDbToDisk, isDbReady } from '@/db';

const TOKEN_SERVICE = 'weread-api-key';

type JsonObject = Record<string, unknown>;
type BookSummary = {
  bookId: string;
  title: string;
  author: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
};
type ExportedBook = BookSummary & { highlights: JsonObject[]; reviews: JsonObject[]; cachedAt?: number };

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {};
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function asNumber(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function formatDate(value: unknown): string {
  const timestamp = asNumber(value);
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN');
}

const BookNotes: React.FC<{ book: ExportedBook }> = ({ book }) => {
  const grouped = new Map<string, JsonObject[]>();
  for (const highlight of book.highlights) {
    const chapter = asObject(highlight.chapter);
    const title = String(chapter.title || highlight.chapterTitle || '未分章节');
    grouped.set(title, [...(grouped.get(title) || []), highlight]);
  }
  return (
    <div className="mt-3 space-y-5 border-t pt-4">
      {[...grouped.entries()].map(([chapter, highlights]) => (
        <section key={chapter} className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">{chapter}</h4>
          {highlights.map((highlight, index) => (
            <blockquote key={String(highlight.bookmarkId || index)} className="border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-sm leading-6">
              <p className="whitespace-pre-wrap">{String(highlight.markText || '')}</p>
              {formatDate(highlight.createTime) && <footer className="mt-1 text-xs text-muted-foreground">{formatDate(highlight.createTime)}</footer>}
            </blockquote>
          ))}
        </section>
      ))}
      {book.reviews.length > 0 && <section className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">想法与点评</h4>
        {book.reviews.map((item, index) => {
          const review = asObject(item.review || item);
          const abstract = String(review.abstract || '').trim();
          const content = String(review.content || '').trim();
          return <div key={String(review.reviewId || index)} className="rounded-md bg-primary/5 p-3 text-sm">
            {abstract && <blockquote className="mb-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">{abstract}</blockquote>}
            <p className="whitespace-pre-wrap leading-6">{content || '（无文字内容）'}</p>
            {formatDate(review.createTime) && <p className="mt-1 text-xs text-muted-foreground">{formatDate(review.createTime)}</p>}
          </div>;
        })}
      </section>}
      {!book.highlights.length && !book.reviews.length && <p className="text-sm text-muted-foreground">这本书没有可查看的划线或想法；书签内容暂不支持读取。</p>}
    </div>
  );
};

function makeMarkdown(books: ExportedBook[]): string {
  const lines = ['# 微信读书笔记', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  for (const book of books) {
    lines.push(`## ${book.title}`, '', book.author ? `作者：${book.author}` : '', '');
    const chapterNames = new Map<string, string>();
    for (const highlight of book.highlights) {
      const chapter = asObject(highlight.chapter);
      if (chapter.chapterUid != null) chapterNames.set(String(chapter.chapterUid), String(chapter.title || '未命名章节'));
    }
    for (const highlight of book.highlights) {
      const text = String(highlight.markText || '').trim();
      if (!text) continue;
      const chapterName = chapterNames.get(String(highlight.chapterUid)) || String(highlight.chapterTitle || '');
      if (chapterName) lines.push(`### ${chapterName}`, '');
      lines.push(...text.split('\n').map((line) => `> ${line}`), '');
    }
    for (const item of book.reviews) {
      const review = asObject(item.review || item);
      const abstract = String(review.abstract || '').trim();
      const content = String(review.content || '').trim();
      if (abstract) lines.push(...abstract.split('\n').map((line) => `> ${line}`), '');
      if (content) lines.push(`**想法/点评：** ${content}`, '');
    }
    if (!book.highlights.length && !book.reviews.length) lines.push('_没有可导出的笔记内容（书签仅支持数量统计）_', '');
  }
  return lines.filter((line, index) => line || lines[index - 1] !== '').join('\n');
}

export const WereadPanel: React.FC = () => {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [mode, setMode] = useState<'reader' | 'notes'>('reader');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [books, setBooks] = useState<ExportedBook[]>([]);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    void window.electronAPI.auth.getToken(TOKEN_SERVICE).then((token) => {
      if (token) setApiKey(token);
    });
  }, []);

  useEffect(() => {
    let attempts = 0;
    const loadCache = () => {
      attempts += 1;
      if (isDbReady()) {
        const cached = dbLoadWereadCache() as ExportedBook[];
        if (cached.length) {
          setBooks(cached);
          setStatus(`已加载本地缓存：${cached.length} 本书`);
        }
        return true;
      }
      return attempts >= 50;
    };
    if (loadCache()) return undefined;
    const timer = window.setInterval(() => { if (loadCache()) window.clearInterval(timer); }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const totals = useMemo(() => books.reduce((result, book) => ({
    highlights: result.highlights + book.highlights.length,
    reviews: result.reviews + book.reviews.length,
    bookmarks: result.bookmarks + book.bookmarkCount,
  }), { highlights: 0, reviews: 0, bookmarks: 0 }), [books]);

  const visibleBooks = useMemo(() => {
    if (!searchQuery.trim()) return books;
    if (isDbReady()) return dbLoadWereadCache(searchQuery) as ExportedBook[];
    const query = searchQuery.trim().toLocaleLowerCase();
    return books.filter((book) => JSON.stringify(book).toLocaleLowerCase().includes(query));
  }, [books, searchQuery]);

  async function request(payload: JsonObject): Promise<JsonObject> {
    let response: Awaited<ReturnType<typeof window.electronAPI.wereadRequest>>;
    try {
      response = await window.electronAPI.wereadRequest(apiKey.trim(), payload);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message.includes("No handler registered for 'weread:request'")) {
        throw new Error('主进程尚未加载微信读书接口。请从系统托盘完全退出应用，然后重新启动。');
      }
      throw reason;
    }
    if (!response.success || !response.data) throw new Error(response.error || '请求微信读书失败');
    return response.data;
  }

  async function loadReviews(bookId: string): Promise<JsonObject[]> {
    const reviews: JsonObject[] = [];
    let synckey = 0;
    for (let page = 0; page < 1000; page += 1) {
      const data = await request({ api_name: '/review/list/mine', bookid: bookId, synckey, count: 100 });
      reviews.push(...asArray(data.reviews));
      if (asNumber(data.hasMore) !== 1) break;
      const next = asNumber(data.synckey);
      if (!next || next === synckey) throw new Error('想法分页游标异常，已停止以避免重复数据');
      synckey = next;
    }
    return reviews;
  }

  async function fetchAllNotes() {
    const key = apiKey.trim();
    if (!key) { setError('请先输入微信读书 API Key'); return; }
    if (!isDbReady()) { setError('本地数据库正在初始化，请稍后重试'); return; }
    setLoading(true); setError(''); setBooks([]); setStatus('正在读取笔记本列表…');
    try {
      await window.electronAPI.auth.saveToken(TOKEN_SERVICE, key, '微信读书 API Key');
      const summaries: BookSummary[] = [];
      let lastSort: number | undefined;
      for (let page = 0; page < 1000; page += 1) {
        const data = await request({ api_name: '/user/notebooks', count: 100, ...(lastSort ? { lastSort } : {}) });
        const pageBooks = asArray(data.books);
        for (const item of pageBooks) {
          const book = asObject(item.book);
          summaries.push({
            bookId: String(item.bookId || book.bookId || ''),
            title: String(book.title || '未命名书籍'), author: String(book.author || ''),
            noteCount: asNumber(item.noteCount), reviewCount: asNumber(item.reviewCount),
            bookmarkCount: asNumber(item.bookmarkCount),
          });
        }
        if (asNumber(data.hasMore) !== 1) break;
        const next = asNumber(pageBooks.at(-1)?.sort);
        if (!next || next === lastSort) throw new Error('笔记本分页游标异常，已停止以避免重复数据');
        lastSort = next;
      }

      const exported: ExportedBook[] = [];
      for (let index = 0; index < summaries.length; index += 1) {
        const summary = summaries[index];
        setStatus(`正在获取 ${index + 1}/${summaries.length}：《${summary.title}》`);
        const [highlightData, reviews] = await Promise.all([
          request({ api_name: '/book/bookmarklist', bookId: summary.bookId }),
          loadReviews(summary.bookId),
        ]);
        const chapters = new Map(asArray(highlightData.chapters).map((chapter) => [String(chapter.chapterUid), chapter]));
        const highlights = asArray(highlightData.updated).map((highlight) => ({
          ...highlight, chapter: chapters.get(String(highlight.chapterUid)),
        }));
        exported.push({ ...summary, highlights, reviews });
        setBooks([...exported]);
      }
      dbReplaceWereadCache(exported);
      await flushDbToDisk();
      setStatus(`获取完成并已缓存到本地：${exported.length} 本书`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('');
    } finally { setLoading(false); }
  }

  async function exportMarkdown() {
    const result = await window.electronAPI.saveFile(makeMarkdown(books), `微信读书笔记-${new Date().toISOString().slice(0, 10)}.md`);
    if (!result.success) setError('导出已取消或保存失败');
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-10 items-center gap-1 border-b bg-background px-2">
        {mode === 'reader' && <>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => webviewRef.current?.goBack()}><ArrowLeft /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => webviewRef.current?.goForward()}><ArrowRight /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => webviewRef.current?.reload()}><RefreshCw /></Button>
        </>}
        <span className="flex-1 truncate px-2 text-xs text-muted-foreground">微信读书</span>
        <Button size="sm" variant={mode === 'reader' ? 'secondary' : 'ghost'} onClick={() => setMode('reader')}>阅读</Button>
        <Button size="sm" variant={mode === 'notes' ? 'secondary' : 'ghost'} onClick={() => setMode('notes')}><BookOpen />笔记导出</Button>
      </div>

      {mode === 'reader' ? (
        <webview ref={webviewRef} src="https://weread.qq.com/" partition="persist:weread" style={{ flex: 1 }}
          // @ts-expect-error webview-specific attribute
          allowpopups="true" />
      ) : (
        <div className="flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-4xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold">导出全部读书笔记</h2>
              <p className="mt-1 text-sm text-muted-foreground">获取全部划线、个人想法和点评。书签内容受接口限制，只统计数量。</p>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)}
                  placeholder="输入 wrk- 开头的微信读书 API Key" className="pr-10" disabled={loading} />
                <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-8 w-8" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <Button onClick={() => void fetchAllNotes()} disabled={loading || !apiKey.trim()}>
                {loading ? <Loader2 /> : <Download />}{loading ? '获取中' : '获取所有笔记'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Key 会使用系统加密能力保存在本机，不会写入项目文件。</p>
            {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {status && <div className="text-sm text-muted-foreground">{status}</div>}
            {books.length > 0 && <>
              <div className="flex items-center justify-between rounded-lg border bg-background p-4">
                <div className="text-sm"><strong>{books.length}</strong> 本书 · <strong>{totals.highlights}</strong> 条划线 · <strong>{totals.reviews}</strong> 条想法/点评 · <strong>{totals.bookmarks}</strong> 个书签</div>
                <Button variant="outline" size="sm" onClick={() => void exportMarkdown()}><Download />导出 Markdown</Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} disabled={loading}
                  placeholder="搜索书名、作者、章节、划线或想法" className="pl-9" />
                {searchQuery && <p className="mt-2 text-xs text-muted-foreground">在本地 SQLite 缓存中找到 {visibleBooks.length} 本相关书籍</p>}
              </div>
              <div className="space-y-2">
                {visibleBooks.map((book) => {
                  const isOpen = openBookId === book.bookId;
                  return <div key={book.bookId} className="rounded-lg border bg-background p-3">
                    <div className="flex items-center gap-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenBookId(isOpen ? null : book.bookId)}>
                        <div className="truncate font-medium">{book.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{book.author || '未知作者'} · {book.highlights.length} 条划线 · {book.reviews.length} 条想法/点评 · {book.bookmarkCount} 个书签</div>
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => setOpenBookId(isOpen ? null : book.bookId)}>{isOpen ? '收起' : '查看笔记'}</Button>
                    </div>
                    {isOpen && <BookNotes book={book} />}
                  </div>;
                })}
                {visibleBooks.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">没有找到匹配的笔记</div>}
              </div>
            </>}
          </div>
        </div>
      )}
    </div>
  );
};
