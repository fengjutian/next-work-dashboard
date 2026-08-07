import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Download, ExternalLink, Eye, EyeOff, History, Loader2, Maximize2, Minus, Plus, RefreshCw, Rows3, Search, SlidersHorizontal, StickyNote, Sun, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dbLoadWereadCache, dbReplaceWereadCache, flushDbToDisk, isDbReady } from '@/db';
import { WereadAnalytics } from './WereadAnalytics';
import { dateKey, formatReadingDuration, loadReadingActivities, saveReadingActivity, type WereadReadingActivity } from './readingActivity';

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
type ReaderPreset = 'compact' | 'comfortable' | 'focus';
type ReaderTheme = 'system' | 'light' | 'dark' | 'eye';
type ReaderPreferences = { preset: ReaderPreset; theme: ReaderTheme; fontScale: number };

const READER_PREFS_KEY = 'weread.reader.preferences';
const READER_POSITIONS_KEY = 'weread.reader.positions';
const FIND_READER_SCROLLER_SCRIPT = `(() => {
  const cached = window.__nextWorkWereadScroller;
  if (cached?.isConnected && cached.scrollHeight > cached.clientHeight) return cached;
  const candidates = [document.scrollingElement, ...document.querySelectorAll('main, article, section, [class*="reader"], [class*="Reader"]')];
  let scroller = document.scrollingElement;
  let largestRange = Math.max(0, (scroller?.scrollHeight || 0) - (scroller?.clientHeight || 0));
  for (const candidate of candidates) {
    if (!candidate) continue;
    const range = candidate.scrollHeight - candidate.clientHeight;
    if (range > largestRange) { scroller = candidate; largestRange = range; }
  }
  window.__nextWorkWereadScroller = scroller;
  return scroller;
})()`;
const READER_PRESETS: Record<ReaderPreset, { fontSize: number; lineHeight: number; width: number; paragraphGap: number }> = {
  compact: { fontSize: 16, lineHeight: 1.75, width: 900, paragraphGap: 14 },
  comfortable: { fontSize: 18, lineHeight: 2, width: 820, paragraphGap: 18 },
  focus: { fontSize: 20, lineHeight: 2.15, width: 760, paragraphGap: 22 },
};

function getReaderPositionKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch { return url.split(/[?#]/, 1)[0]; }
}

function getBookId(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.match(/\/reader\/([^/?#]+)/)?.[1] ?? '';
  } catch { return ''; }
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const readerCssKeyRef = useRef<string | null>(null);
  const readerSettingsRef = useRef<HTMLDivElement>(null);
  const readingActivityRef = useRef<WereadReadingActivity | null>(null);
  const unflushedReadingSecondsRef = useRef(0);
  const zenControlsTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<'reader' | 'notes' | 'analytics'>('reader');
  const visitedModes = useRef(new Set<'reader' | 'notes' | 'analytics'>(['reader']));
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [books, setBooks] = useState<ExportedBook[]>([]);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [webviewReady, setWebviewReady] = useState(false);
  const [readerLoadVersion, setReaderLoadVersion] = useState(0);
  const [zenMode, setZenMode] = useState(false);
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [sessionReadingSeconds, setSessionReadingSeconds] = useState(0);
  const [currentReading, setCurrentReading] = useState<WereadReadingActivity | null>(null);
  const [recentReadings, setRecentReadings] = useState<WereadReadingActivity[]>(loadReadingActivities);
  const [recentReadingsOpen, setRecentReadingsOpen] = useState(false);
  const [zenControlsVisible, setZenControlsVisible] = useState(true);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(() => {
    try { return { preset: 'comfortable', theme: 'system', fontScale: 1, ...JSON.parse(localStorage.getItem(READER_PREFS_KEY) ?? '{}') }; }
    catch { return { preset: 'comfortable', theme: 'system', fontScale: 1 }; }
  });

  const saveReaderPreferences = (patch: Partial<ReaderPreferences>) => {
    setReaderPreferences((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const flushReadingActivity = useCallback(() => {
    const activity = readingActivityRef.current;
    const elapsed = unflushedReadingSecondsRef.current;
    if (!activity || elapsed <= 0) return;
    const today = dateKey();
    const next = {
      ...activity,
      totalSeconds: activity.totalSeconds + elapsed,
      lastReadAt: Date.now(),
      dailySeconds: { ...activity.dailySeconds, [today]: (activity.dailySeconds[today] || 0) + elapsed },
    };
    unflushedReadingSecondsRef.current = 0;
    readingActivityRef.current = next;
    setCurrentReading(next);
    setRecentReadings(saveReadingActivity(next));
  }, []);

  const applyReaderStyles = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || !webviewReady) return;
    if (readerCssKeyRef.current) {
      try { await webview.removeInsertedCSS(readerCssKeyRef.current); } catch { /* page navigation can invalidate an old key */ }
    }
    const preset = READER_PRESETS[readerPreferences.preset];
    const fontSize = Math.round(preset.fontSize * readerPreferences.fontScale * 10) / 10;
    const overlay = readerPreferences.theme === 'eye'
      ? 'rgba(225, 205, 135, .22)'
      : readerPreferences.theme === 'dark'
        ? 'rgba(0, 0, 0, .24)'
        : readerPreferences.theme === 'light'
          ? 'rgba(255, 255, 255, .14)'
          : 'transparent';
    const overlayBlend = readerPreferences.theme === 'light' ? 'screen' : 'multiply';
    readerCssKeyRef.current = await webview.insertCSS(`
      html { scrollbar-width: thin; scrollbar-color: rgba(127,127,127,.35) transparent; }
      ::-webkit-scrollbar { width: 7px; height: 7px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(127,127,127,.32); background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,.55); background-clip: padding-box; }
      .nwd-weread-text { margin-bottom: ${preset.paragraphGap}px !important; font-size: ${fontSize}px !important; line-height: ${preset.lineHeight} !important; }
      body::after { content: ''; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; background: ${overlay}; mix-blend-mode: ${overlayBlend}; }
    `);
    await webview.executeJavaScript(`(() => {
      const markTextBlocks = () => {
        const roots = document.querySelectorAll('.wr_readerContent, .readerChapterContent, [class*="readerChapterContent"], [class*="readerContent"], [class*="ReaderContent"]');
        for (const root of roots) {
          const blocks = root.querySelectorAll('p, blockquote, li, h1, h2, h3, div');
          for (const block of blocks) {
            const text = (block.textContent || '').trim();
            const hasNestedBlock = block.querySelector(':scope > p, :scope > blockquote, :scope > li, :scope > h1, :scope > h2, :scope > h3, :scope > div');
            if (text.length >= 12 && !hasNestedBlock) block.classList.add('nwd-weread-text');
          }
        }
      };
      markTextBlocks();
      clearTimeout(window.__nextWorkWereadMarkTimer);
      window.__nextWorkWereadMarkTimer = setTimeout(markTextBlocks, 800);
    })()`);
  }, [readerPreferences, webviewReady]);

  useEffect(() => {
    void window.electronAPI.auth.getToken(TOKEN_SERVICE).then((token) => {
      if (token) setApiKey(token);
    });
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const onFinish = () => {
      setWebviewReady(true);
      setReaderLoadVersion((version) => version + 1);
    };
    const onNavigate = () => setReaderLoadVersion((version) => version + 1);
    const loadingFallback = window.setTimeout(() => setWebviewReady(true), 12_000);
    webview.addEventListener('dom-ready', onFinish);
    webview.addEventListener('did-stop-loading', onFinish);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    return () => {
      window.clearTimeout(loadingFallback);
      webview.removeEventListener('dom-ready', onFinish);
      webview.removeEventListener('did-stop-loading', onFinish);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
    };
  }, []);

  useEffect(() => { void applyReaderStyles(); }, [applyReaderStyles, readerLoadVersion]);

  useEffect(() => {
    if (!webviewReady || mode !== 'reader') return;
    const webview = webviewRef.current;
    if (!webview) return;
    const readMetadata = async () => {
      try {
        const url = webview.getURL();
        const bookId = getBookId(url);
        if (!bookId) { readingActivityRef.current = null; setCurrentReading(null); return; }
        flushReadingActivity();
        const metadata = await webview.executeJavaScript(`(() => {
          const chapterSelectors = ['.readerChapterContent_title', '[class*="chapterTitle"]', '[class*="ChapterTitle"]', '.readerChapterContent h1', '.readerChapterContent h2', 'article h1', 'article h2'];
          const chapter = chapterSelectors.map((selector) => document.querySelector(selector)?.textContent?.trim()).find(Boolean) || '';
          const cover = document.querySelector('meta[property="og:image"]')?.content || document.querySelector('[class*="bookCover"] img, [class*="readerBook"] img')?.src || '';
          return { title: document.title || '', chapter, cover };
        })()` ) as { title?: string; chapter?: string; cover?: string };
        const saved = loadReadingActivities().find((item) => item.bookId === bookId);
        const title = String(metadata.title || saved?.title || '微信读书').replace(/[-_|]\s*微信读书.*$/i, '').trim();
        const next: WereadReadingActivity = {
          bookId, url, title: title || saved?.title || '微信读书', coverUrl: String(metadata.cover || saved?.coverUrl || ''),
          chapter: String(metadata.chapter || saved?.chapter || ''), progress: saved?.progress || 0,
          totalSeconds: saved?.totalSeconds || 0, lastReadAt: Date.now(), dailySeconds: saved?.dailySeconds || {},
        };
        readingActivityRef.current = next;
        setCurrentReading(next);
        setRecentReadings(saveReadingActivity(next));
      } catch { /* reading metadata can be unavailable during navigation */ }
    };
    const timer = window.setTimeout(() => { void readMetadata(); }, 700);
    return () => window.clearTimeout(timer);
  }, [flushReadingActivity, mode, readerLoadVersion, webviewReady]);

  useEffect(() => {
    if (!readerSettingsOpen) return;
    const closeSettings = (event: MouseEvent) => {
      if (!readerSettingsRef.current?.contains(event.target as Node)) setReaderSettingsOpen(false);
    };
    document.addEventListener('mousedown', closeSettings);
    return () => document.removeEventListener('mousedown', closeSettings);
  }, [readerSettingsOpen]);

  useEffect(() => {
    if (!webviewReady || mode !== 'reader') return;
    const webview = webviewRef.current;
    if (!webview) return;
    let disposed = false;
    const restore = async () => {
      try {
        const url = getReaderPositionKey(webview.getURL());
        const positions = JSON.parse(localStorage.getItem(READER_POSITIONS_KEY) ?? '{}') as Record<string, number>;
        const ratio = positions[url];
        if (Number.isFinite(ratio) && ratio > 0) await webview.executeJavaScript(`(() => { const e = ${FIND_READER_SCROLLER_SCRIPT}; if (e) e.scrollTop = ${ratio} * Math.max(0, e.scrollHeight - e.clientHeight); })()`);
      } catch { /* page may still be navigating */ }
    };
    const restoreTimer = window.setTimeout(() => { void restore(); }, 500);
    const timer = window.setInterval(async () => {
      try {
        const ratio = Number(await webview.executeJavaScript(`(() => { const e = ${FIND_READER_SCROLLER_SCRIPT}; return e && e.scrollHeight > e.clientHeight ? e.scrollTop / (e.scrollHeight - e.clientHeight) : 0; })()`));
        if (disposed || !Number.isFinite(ratio)) return;
        const safeRatio = Math.max(0, Math.min(1, ratio));
        setReadingProgress(Math.round(safeRatio * 100));
        const url = getReaderPositionKey(webview.getURL());
        if (readingActivityRef.current) readingActivityRef.current = { ...readingActivityRef.current, url: webview.getURL(), progress: safeRatio };
        const positions = JSON.parse(localStorage.getItem(READER_POSITIONS_KEY) ?? '{}') as Record<string, number>;
        positions[url] = safeRatio;
        localStorage.setItem(READER_POSITIONS_KEY, JSON.stringify(positions));
      } catch { /* ignore transient navigation state */ }
    }, 1200);
    return () => { disposed = true; window.clearTimeout(restoreTimer); window.clearInterval(timer); };
  }, [mode, readerLoadVersion, webviewReady]);

  useEffect(() => {
    if (!webviewReady || mode !== 'reader' || !currentReading?.bookId) return;
    const pause = () => flushReadingActivity();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !document.hasFocus() || !readingActivityRef.current) return;
      unflushedReadingSecondsRef.current += 1;
      setSessionReadingSeconds((seconds) => seconds + 1);
      if (unflushedReadingSecondsRef.current >= 10) flushReadingActivity();
    }, 1000);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', pause);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', pause);
      flushReadingActivity();
    };
  }, [currentReading?.bookId, flushReadingActivity, mode, webviewReady]);

  useEffect(() => {
    const syncFullscreen = () => setZenMode(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!zenMode) { setZenControlsVisible(true); return; }
    const panel = panelRef.current;
    const webview = webviewRef.current;
    if (!panel || !webview) return;
    const revealControls = () => {
      setZenControlsVisible(true);
      if (zenControlsTimerRef.current) window.clearTimeout(zenControlsTimerRef.current);
      zenControlsTimerRef.current = window.setTimeout(() => setZenControlsVisible(false), 2200);
    };
    const onGuestConsole = (event: Event) => {
      if ((event as Event & { message?: string }).message === '__NWD_WEREAD_POINTER__') revealControls();
    };
    revealControls();
    panel.addEventListener('mousemove', revealControls);
    webview.addEventListener('console-message', onGuestConsole);
    void webview.executeJavaScript(`(() => {
      if (window.__nextWorkWereadPointerHandler) document.removeEventListener('mousemove', window.__nextWorkWereadPointerHandler);
      let lastSignal = 0;
      window.__nextWorkWereadPointerHandler = () => { const now = Date.now(); if (now - lastSignal > 400) { lastSignal = now; console.debug('__NWD_WEREAD_POINTER__'); } };
      document.addEventListener('mousemove', window.__nextWorkWereadPointerHandler, { passive: true });
    })()`);
    return () => {
      panel.removeEventListener('mousemove', revealControls);
      webview.removeEventListener('console-message', onGuestConsole);
      void webview.executeJavaScript(`(() => { if (window.__nextWorkWereadPointerHandler) document.removeEventListener('mousemove', window.__nextWorkWereadPointerHandler); delete window.__nextWorkWereadPointerHandler; })()`);
      if (zenControlsTimerRef.current) window.clearTimeout(zenControlsTimerRef.current);
    };
  }, [zenMode]);

  useEffect(() => {
    if (!zenMode) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const turnPage = (direction: 'previous' | 'next') => {
      const key = direction === 'previous' ? 'ArrowLeft' : 'ArrowRight';
      void webviewRef.current?.executeJavaScript(`(() => {
        const labels = ${direction === 'previous' ? "['上一章','上一页']" : "['下一章','下一页']"};
        const button = [...document.querySelectorAll('button, [role="button"], a')].find((item) => labels.some((label) => (item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '').includes(label)));
        if (button) { button.click(); return true; }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true }));
        return false;
      })()`);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      turnPage(event.key === 'ArrowLeft' ? 'previous' : 'next');
    };
    window.addEventListener('keydown', onKeyDown);
    void webview.executeJavaScript(`(() => {
      if (window.__nextWorkWereadKeyHandler) window.removeEventListener('keydown', window.__nextWorkWereadKeyHandler, true);
      window.__nextWorkWereadKeyHandler = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const labels = event.key === 'ArrowLeft' ? ['上一章','上一页'] : ['下一章','下一页'];
        const button = [...document.querySelectorAll('button, [role="button"], a')].find((item) => labels.some((label) => (item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '').includes(label)));
        if (button) { event.preventDefault(); event.stopPropagation(); button.click(); }
      };
      window.addEventListener('keydown', window.__nextWorkWereadKeyHandler, true);
    })()`);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      void webview.executeJavaScript(`(() => { if (window.__nextWorkWereadKeyHandler) window.removeEventListener('keydown', window.__nextWorkWereadKeyHandler, true); delete window.__nextWorkWereadKeyHandler; })()`);
    };
  }, [zenMode]);

  const toggleZenMode = async () => {
    try {
      if (document.fullscreenElement === panelRef.current) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch { setError('当前系统无法进入全屏模式'); }
  };

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
      return attempts >= 30;
    };
    if (loadCache()) return undefined;
    const timer = window.setInterval(() => { if (loadCache()) window.clearInterval(timer); }, 300);
    return () => window.clearInterval(timer);
  }, []);

  const totals = useMemo(() => books.reduce((result, book) => ({
    highlights: result.highlights + book.highlights.length,
    reviews: result.reviews + book.reviews.length,
    bookmarks: result.bookmarks + book.bookmarkCount,
  }), { highlights: 0, reviews: 0, bookmarks: 0 }), [books]);

  const visibleBooks = useMemo(() => {
    if (!searchQuery.trim()) return books;
    const query = searchQuery.trim().toLocaleLowerCase();
    if (isDbReady()) {
      try { return dbLoadWereadCache(searchQuery) as ExportedBook[]; } catch { /* fall through */ }
    }
    return books.filter((book) =>
      book.title.toLocaleLowerCase().includes(query) ||
      book.author.toLocaleLowerCase().includes(query)
    );
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
      let lastUpdate = 0;
      const BATCH_SIZE = 5;
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
        const now = Date.now();
        if (exported.length % BATCH_SIZE === 0 || now - lastUpdate > 300 || index === summaries.length - 1) {
          setBooks([...exported]);
          lastUpdate = now;
        }
      }
      const sync = dbReplaceWereadCache(exported);
      await flushDbToDisk();
      setStatus(`获取完成并已缓存：${exported.length} 本书 · 新增 ${sync.addedNotes} 条 · 删除 ${sync.deletedNotes} 条 · 更新 ${sync.updatedBooks} 本`);
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
    <div ref={panelRef} className="weread-panel flex h-full flex-col bg-card">
      {!zenMode && <div className="relative flex h-10 items-center gap-1 border-b bg-background px-2">
        {mode === 'reader' && <>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="后退" aria-label="后退" onClick={() => webviewRef.current?.goBack()}><ArrowLeft /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="前进" aria-label="前进" onClick={() => webviewRef.current?.goForward()}><ArrowRight /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="刷新" aria-label="刷新" onClick={() => webviewRef.current?.reload()}><RefreshCw /></Button>
        </>}
        <span className="flex-1 truncate px-2 text-xs text-muted-foreground">微信读书</span>
        <Button size="icon" className="h-8 w-8" variant={mode === 'reader' ? 'secondary' : 'ghost'} title="阅读" aria-label="阅读" onClick={() => { visitedModes.current.add('reader'); setMode('reader'); }}><BookOpen className="h-4 w-4" /></Button>
        <Button size="icon" className="h-8 w-8" variant={mode === 'notes' ? 'secondary' : 'ghost'} title="笔记导出" aria-label="笔记导出" onClick={() => setMode('notes')}><StickyNote className="h-4 w-4" /></Button>
        <Button size="icon" className="h-8 w-8" variant={mode === 'analytics' ? 'secondary' : 'ghost'} title="阅读分析" aria-label="阅读分析" onClick={() => { visitedModes.current.add('analytics'); setMode('analytics'); }}><Rows3 className="h-4 w-4" /></Button>
        {mode === 'reader' && <Button size="icon" className="h-8 w-8" variant={recentReadingsOpen ? 'secondary' : 'ghost'} title="最近阅读" aria-label="最近阅读" onClick={() => setRecentReadingsOpen((open) => !open)}><History className="h-4 w-4" /></Button>}
        {mode === 'reader' && <span className="min-w-8 text-center text-[10px] tabular-nums text-muted-foreground" title="阅读进度">{readingProgress}%</span>}
        {mode === 'reader' && <div ref={readerSettingsRef} className="relative">
          <Button size="icon" className="h-8 w-8" variant={readerSettingsOpen ? 'secondary' : 'ghost'} title="阅读排版" aria-label="阅读排版" aria-expanded={readerSettingsOpen} onClick={() => setReaderSettingsOpen((open) => !open)}><SlidersHorizontal className="h-4 w-4" /></Button>
          {readerSettingsOpen && <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl">
            <div className="mb-2 text-xs font-medium">阅读排版</div>
            <div className="grid grid-cols-3 gap-1">
              {(['compact', 'comfortable', 'focus'] as ReaderPreset[]).map((preset) => <button key={preset} type="button" className={`rounded px-2 py-1.5 text-[10px] ${readerPreferences.preset === preset ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`} onClick={() => saveReaderPreferences({ preset })}>{{ compact: '紧凑', comfortable: '舒适', focus: '专注' }[preset]}</button>)}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex-1 text-[10px] text-muted-foreground">字号</span>
              <Button size="icon" variant="outline" className="h-7 w-7" title="减小字号" onClick={() => saveReaderPreferences({ fontScale: Math.max(.8, Number((readerPreferences.fontScale - .1).toFixed(1))) })}><Minus className="h-3.5 w-3.5" /></Button>
              <span className="w-9 text-center text-[10px] tabular-nums">{Math.round(readerPreferences.fontScale * 100)}%</span>
              <Button size="icon" variant="outline" className="h-7 w-7" title="增大字号" onClick={() => saveReaderPreferences({ fontScale: Math.min(1.5, Number((readerPreferences.fontScale + .1).toFixed(1))) })}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1">
              {(['system', 'light', 'dark', 'eye'] as ReaderTheme[]).map((readerTheme) => <button key={readerTheme} type="button" className={`rounded px-1 py-1.5 text-[10px] ${readerPreferences.theme === readerTheme ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`} onClick={() => saveReaderPreferences({ theme: readerTheme })}>{{ system: '跟随', light: '亮色', dark: '暗色', eye: '护眼' }[readerTheme]}</button>)}
            </div>
          </div>}
        </div>}
        {mode === 'reader' && <Button size="icon" className="h-8 w-8" variant="ghost" title="禅模式：全屏看书" aria-label="禅模式：全屏看书" onClick={() => void toggleZenMode()}><Maximize2 className="h-4 w-4" /></Button>}
        {mode === 'reader' && recentReadingsOpen && <div className="absolute right-24 top-10 z-50 w-80 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="border-b px-3 py-2 text-xs font-medium">最近阅读</div>
          <div className="weread-scroll max-h-96 overflow-auto p-1.5">
            {recentReadings.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted-foreground">打开一本书后会自动记录</p>}
            {recentReadings.map((item) => <button key={item.bookId} type="button" className="flex w-full gap-3 rounded-md p-2 text-left hover:bg-accent" onClick={() => { webviewRef.current?.loadURL(item.url); setRecentReadingsOpen(false); setMode('reader'); }}>
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">{item.coverUrl && <img src={item.coverUrl} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={item.title}>{item.title}</p><p className="mt-1 truncate text-[10px] text-muted-foreground" title={item.chapter}>{item.chapter || '上次阅读位置'}</p><p className="mt-1 text-[10px] tabular-nums text-muted-foreground">{Math.round(item.progress * 100)}% · {formatReadingDuration(item.totalSeconds)}</p></div>
            </button>)}
          </div>
        </div>}
      </div>}

      {zenMode && <div className={`fixed right-4 top-4 z-[100] flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-1 rounded-full bg-background/75 p-1 shadow-lg backdrop-blur transition-all duration-300 ${zenControlsVisible ? 'translate-y-0 opacity-100' : '-translate-y-3 pointer-events-none opacity-0'}`}>
        <span className="min-w-0 truncate px-2 text-[10px] text-muted-foreground" title={currentReading?.chapter || currentReading?.title}>{currentReading?.chapter || currentReading?.title || '微信读书'}</span>
        <span className="shrink-0 px-2 text-[10px] tabular-nums text-muted-foreground">{readingProgress}% · {formatReadingDuration(sessionReadingSeconds)}</span>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" title="切换阅读主题" aria-label="切换阅读主题" onClick={() => { const themes: ReaderTheme[] = ['system', 'light', 'eye', 'dark']; const index = themes.indexOf(readerPreferences.theme); saveReaderPreferences({ theme: themes[(index + 1) % themes.length] }); }}><Sun className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" title="退出禅模式（Esc）" aria-label="退出禅模式" onClick={() => void toggleZenMode()}><X className="h-4 w-4" /></Button>
      </div>}

      {visitedModes.current.has('reader') && (
        <div style={{ flex: mode === 'reader' ? 1 : 0, display: mode === 'reader' ? undefined : 'none', position: 'relative' }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-muted/40" aria-hidden="true">
            <div className="h-full bg-primary/70 transition-[width] duration-300" style={{ width: `${readingProgress}%` }} />
          </div>
          {!webviewReady && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">正在加载微信读书…</span>
              </div>
            </div>
          )}
          <webview ref={webviewRef} src="https://weread.qq.com/" partition="persist:weread"
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            // @ts-expect-error webview-specific attribute
            allowpopups="true" />
        </div>
      )}
      {visitedModes.current.has('analytics') && (
        <div style={{ flex: mode === 'analytics' ? 1 : 0, display: mode === 'analytics' ? undefined : 'none', overflow: 'hidden' }}>
          <WereadAnalytics books={books} readingActivities={recentReadings} onSelectBook={(bookId) => { setOpenBookId(bookId); setSearchQuery(''); setMode('notes'); }} />
        </div>
      )}
      <div style={{ flex: mode === 'notes' ? 1 : 0, display: mode === 'notes' ? undefined : 'none', overflow: 'hidden' }}>
        <div className="weread-scroll flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-4xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold">导出全部读书笔记</h2>
              <p className="mt-1 text-sm text-muted-foreground">获取全部划线、个人想法和点评。书签内容受接口限制，只统计数量。</p>
              <Button variant="link" className="mt-1 h-auto px-0 text-sm" onClick={() => void window.electronAPI.shell.openExternal('https://weread.qq.com/r/weread-skills')}>
                获取微信读书 API Key <ExternalLink className="h-3.5 w-3.5" />
              </Button>
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
      </div>
    </div>
  );
};
