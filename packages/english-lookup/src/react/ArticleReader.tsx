import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe, History, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { useEnglishLookupAdapter } from "./context";
import { normalizeWord } from "../core/model";
import type { EnglishLookupChatMessage, EnglishLookupChatOptions } from "./adapter";

interface ArticleResult {
  title: string;
  summary: string;
  paragraphs: Array<{ original: string; translation: string }>;
}
interface ExtractedPage {
  title: string;
  text: string;
  blocked?: boolean;
}
const VOCABULARY_LEVELS = [
  "高中",
  "大学4级",
  "大学6级",
  "英专8级",
  "托福",
  "雅思",
] as const;
const URL_HISTORY_KEY = "nwd.english-lookup.website-history";
type VocabularyLevel = (typeof VOCABULARY_LEVELS)[number];
interface LeveledWord {
  word: string;
  meaning: string;
}
type VocabularyGroups = Record<VocabularyLevel, LeveledWord[]>;

/** Minimal Electron-style webview surface used by the article reader.
 *  Hosts that ship a real `Electron.WebviewTag` (or compatible polyfill)
 *  can assign it directly to the ref. */
interface EnglishLookupWebviewElement {
  src: string;
  partition: string;
  executeJavaScript(code: string): Promise<unknown>;
  addEventListener(name: "did-start-loading" | "did-stop-loading" | "did-fail-load", handler: () => void): void;
  removeEventListener(name: string, handler: () => void): void;
}

function parseVocabularyGroups(raw: string): VocabularyGroups {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 没有返回可识别的分级词汇");
  const value = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  return Object.fromEntries(
    VOCABULARY_LEVELS.map((level) => {
      const entries = value[level];
      return [
        level,
        Array.isArray(entries)
          ? entries
              .filter(
                (item): item is LeveledWord =>
                  !!item &&
                  typeof item === "object" &&
                  typeof (item as LeveledWord).word === "string" &&
                  typeof (item as LeveledWord).meaning === "string",
              )
              .slice(0, 40)
          : [],
      ];
    }),
  ) as VocabularyGroups;
}

export function normalizeWebsiteUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("仅支持 HTTP 或 HTTPS 网站");
  return url.toString();
}

function parseArticle(raw: string): ArticleResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 没有返回可识别的文章翻译");
  const value = JSON.parse(fenced.slice(start, end + 1)) as Partial<ArticleResult>;
  const paragraphs = Array.isArray(value.paragraphs)
    ? value.paragraphs
        .filter(
          (item) =>
            item &&
            typeof item.original === "string" &&
            typeof item.translation === "string",
        )
        .slice(0, 100)
    : [];
  if (!paragraphs.length) throw new Error("翻译结果缺少段落");
  return {
    title: String(value.title || "文章阅读"),
    summary: String(value.summary || ""),
    paragraphs,
  };
}

const EXTRACT_PAGE_SCRIPT = `(() => {
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  if (!root) return { title: document.title || '', text: '', blocked: false };
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,nav,header,footer,aside,form,button,[aria-hidden="true"]').forEach((node) => node.remove());
  const text = (clone.innerText || clone.textContent || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const blocked = /(captcha|verify you are human|access denied|just a moment|登录后|请登录|验证码)/i.test(text.slice(0, 1200));
  return { title: document.title || location.hostname, text: text.slice(0, 30000), blocked };
})()`;

export interface ArticleReaderProps {
  onBack: () => void;
  onLookup: (word: string, context: string) => void;
  speak: (text: string) => void;
  /** AI config: apiKey, baseUrl, model, optional provider tag (e.g. "qwen").
   *  The host decides how to use the provider tag when wiring its chat
   *  factory (e.g. inject a chatProxy for certain upstream endpoints). */
  ai: { apiKey: string; baseUrl: string; model: string; provider?: string };
}

export function ArticleReader({ onBack, onLookup, speak, ai }: ArticleReaderProps) {
  const { ai: aiAdapter, storage } = useEnglishLookupAdapter();
  const [mode, setMode] = useState<"website" | "paste">("website");
  const [article, setArticle] = useState("");
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlHistory, setUrlHistory] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        storage.getItem(URL_HISTORY_KEY) || "[]",
      ) as unknown;
      return Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState("");
  const [extractingWords, setExtractingWords] = useState(false);
  const [vocabulary, setVocabulary] = useState<VocabularyGroups | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const webviewRef = useRef<EnglishLookupWebviewElement | null>(null);
  const extractRef = useRef<() => Promise<void>>(async () => undefined);
  const wordCount = useMemo(
    () => (article.trim() ? article.trim().split(/\s+/).length : 0),
    [article],
  );
  useEffect(() => {
    try {
      storage.setItem(URL_HISTORY_KEY, JSON.stringify(urlHistory));
    } catch {
      /* Storage may be unavailable in a restricted renderer. */
    }
  }, [storage, urlHistory]);

  const translateText = async (input: string, title = "") => {
    setError("");
    if (!input.trim()) {
      setError(
        mode === "website" ? "没有读取到可翻译的正文" : "请粘贴英文文章",
      );
      return;
    }
    if (
      !ai.apiKey?.trim() ||
      !ai.baseUrl?.trim() ||
      !ai.model?.trim()
    ) {
      setError("请先在设置中配置 AI 服务");
      return;
    }
    const controller = new AbortController();
    setVocabulary(null);
    abortRef.current = controller;
    setLoading(true);
    setResult(null);
    try {
      const provider = aiAdapter.createChatProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, provider: ai.provider });
      const messages: EnglishLookupChatMessage[] = [
        {
          role: "system",
          content:
            'Translate the article into natural Chinese. Preserve paragraph boundaries and factual meaning. Return JSON only: {"title":"Chinese title","summary":"concise Chinese summary","paragraphs":[{"original":"exact source paragraph","translation":"Chinese translation"}]}. Do not omit content.',
        },
        { role: "user", content: `${title ? `Page title: ${title}\n\n` : ""}${input.slice(0, 30_000)}` },
      ];
      const options: EnglishLookupChatOptions = {
        model: ai.model,
        temperature: 0.15,
        maxTokens: 8000,
        stream: true,
        signal: controller.signal,
      };
      let raw = "";
      for await (const chunk of provider.chat(messages, options)) raw += chunk.delta ?? "";
      setResult(parseArticle(raw));
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "翻译已取消"
          : reason instanceof Error
            ? reason.message
            : "文章翻译失败",
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const extractVocabulary = async () => {
    if (!article.trim()) {
      setError("请先读取或粘贴文章正文");
      return;
    }
    if (
      !ai.apiKey?.trim() ||
      !ai.baseUrl?.trim() ||
      !ai.model?.trim()
    ) {
      setError("请先在设置中配置 AI 服务");
      return;
    }
    setError("");
    setExtractingWords(true);
    try {
      const provider = aiAdapter.createChatProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, provider: ai.provider });
      const messages: EnglishLookupChatMessage[] = [
        {
          role: "system",
          content: `Extract useful English vocabulary that actually appears in the supplied article. Assign every word to exactly one best-fit Chinese exam level: 高中, 大学4级, 大学6级, 英专8级, 托福, 雅思. Prefer dictionary headwords, exclude names and very basic words, deduplicate case-insensitively. Return JSON only with exactly these six keys. Each value is an array of {"word":"English headword","meaning":"concise Chinese meaning in this context"}. Use an empty array when none.`,
        },
        { role: "user", content: article.slice(0, 30_000) },
      ];
      let raw = "";
      for await (const chunk of provider.chat(messages, { model: ai.model, temperature: 0.1, maxTokens: 5000, stream: true })) raw += chunk.delta ?? "";
      setVocabulary(parseVocabularyGroups(raw));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分级词汇提取失败");
    } finally {
      setExtractingWords(false);
    }
  };

  const extractAndTranslate = async () => {
    const webview = webviewRef.current;
    if (!webview) return;
    setError("");
    try {
      const extracted = (await webview.executeJavaScript(EXTRACT_PAGE_SCRIPT)) as ExtractedPage;
      setArticle(extracted.text || "");
      setPageTitle(extracted.title || "");
      if (extracted.blocked) {
        setError(
          "网站要求登录或人机验证。请在左侧完成验证后点击“重新读取”；应用不会绕过网站限制。",
        );
        return;
      }
      if ((extracted.text || "").length < 80) {
        setError(
          "网站未提供可读取的正文，可能禁止访问或内容尚未加载。可登录后重试，或改用“粘贴文本”。",
        );
        return;
      }
      await translateText(extracted.text, extracted.title);
    } catch {
      setError(
        "无法读取这个网站的正文。网站可能限制访问；可在左侧登录后重试，或改用“粘贴文本”。",
      );
    }
  };
  extractRef.current = extractAndTranslate;

  const openWebsite = (value = urlInput) => {
    setError("");
    setResult(null);
    setArticle("");
    try {
      const normalized = normalizeWebsiteUrl(value);
      setUrlInput(normalized);
      setPageUrl(normalized);
      setUrlHistory((current) =>
        [normalized, ...current.filter((item) => item !== normalized)].slice(0, 20),
      );
      setHistoryOpen(false);
      setPageLoading(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请输入有效网址");
    }
  };
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !pageUrl) return;
    const started = () => setPageLoading(true);
    const stopped = () => {
      setPageLoading(false);
      void extractRef.current();
    };
    const failed = () => {
      setPageLoading(false);
      setError("网站加载失败。请检查网址或网络；若网站限制访问，可改用“粘贴文本”。");
    };
    webview.addEventListener("did-start-loading", started);
    webview.addEventListener("did-stop-loading", stopped);
    webview.addEventListener("did-fail-load", failed);
    return () => {
      webview.removeEventListener("did-start-loading", started);
      webview.removeEventListener("did-stop-loading", stopped);
      webview.removeEventListener("did-fail-load", failed);
    };
  }, [pageUrl]);
  const lookupSelection = (text: string) => {
    const word = normalizeWord(window.getSelection()?.toString() ?? "");
    if (word && word.length <= 80) onLookup(word, text);
  };

  const translationPane = (
    <div className="h-[45vh] min-h-[320px] overflow-auto bg-muted/20 p-3 sm:p-4 lg:h-auto lg:min-h-0">
      {loading && (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <span>正在翻译正文…</span>
          <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
            取消
          </Button>
        </div>
      )}
      {!loading && !result && (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <FileText className="h-7 w-7" />
          </div>
          <p>
            {pageUrl
              ? "网页读取完成后，译文会显示在这里"
              : "输入网址并查询，左侧浏览原网站，右侧查看中文翻译"}
          </p>
        </div>
      )}
      {!loading && result && (
        <div className="space-y-3">
          <section className="rounded-xl border bg-primary/5 p-4">
            <h1 className="text-lg font-semibold">{result.title}</h1>
            {result.summary && (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.summary}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowOriginal((value) => !value)}>
                {showOriginal ? "仅中文" : "显示原文"}
              </Button>
              <Button size="sm" variant="outline" disabled={extractingWords} onClick={() => void extractVocabulary()}>
                {extractingWords ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                提取分级词汇
              </Button>
            </div>
          </section>
          {vocabulary && (
            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center">
                <h2 className="text-sm font-semibold">本文分级词汇</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  {VOCABULARY_LEVELS.reduce((sum, level) => sum + vocabulary[level].length, 0)} 词
                </span>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {VOCABULARY_LEVELS.map((level) => (
                  <div key={level} className="rounded-lg bg-muted/40 p-3">
                    <div className="mb-2 text-xs font-semibold text-primary">
                      {level} · {vocabulary[level].length}
                    </div>
                    {vocabulary[level].length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {vocabulary[level].map((item) => (
                          <button
                            key={`${level}-${item.word}`}
                            title={item.meaning}
                            onClick={() => onLookup(item.word, article)}
                            className="rounded-md border bg-background px-2 py-1 text-left text-xs hover:border-primary/40 hover:bg-primary/5"
                          >
                            <b>{item.word}</b>
                            <span className="ml-1 text-muted-foreground">{item.meaning}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">本文无对应词汇</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {result.paragraphs.map((item, index) => (
            <article key={index} className="rounded-xl border bg-card p-4">
              {showOriginal && (
                <div onMouseUp={() => lookupSelection(item.original)}>
                  <div className="flex items-center">
                    <span className="text-[10px] text-muted-foreground">原文 · 选中文字可查询</span>
                    <Button className="ml-auto" size="sm" variant="ghost" onClick={() => speak(item.original)}>
                      朗读
                    </Button>
                  </div>
                  <p className="mt-2 select-text text-sm leading-7">{item.original}</p>
                  <div className="my-3 border-t" />
                </div>
              )}
              <span className="text-[10px] text-muted-foreground">中文</span>
              <p className="mt-2 text-sm leading-7">{item.translation}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-auto w-full flex-col overflow-hidden rounded-lg border bg-card lg:h-[calc(100vh-145px)] lg:min-h-[560px] lg:rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 sm:p-3">
        <div className="flex w-full rounded-lg bg-muted p-1 sm:w-auto">
          <button
            onClick={onBack}
            className="flex-1 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-background/70 hover:text-foreground sm:flex-none"
          >
            单词查询
          </button>
          <button
            onClick={() => setMode("website")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs sm:flex-none ${mode === "website" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            网站翻译
          </button>
          <button
            onClick={() => setMode("paste")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs sm:flex-none ${mode === "paste" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            粘贴文本
          </button>
        </div>
        {mode === "website" && (
          <>
            <Globe className="ml-1 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            <div className="relative min-w-0 flex-[1_1_16rem]">
              <input
                aria-label="网站地址"
                value={urlInput}
                onFocus={() => setHistoryOpen(true)}
                onBlur={() => window.setTimeout(() => setHistoryOpen(false), 120)}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setHistoryOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openWebsite();
                  if (event.key === "Escape") setHistoryOpen(false);
                }}
                placeholder="输入网址，例如 example.com/article"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              {historyOpen && urlHistory.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-auto rounded-lg border bg-card p-1 shadow-xl">
                  <div className="flex items-center px-2 py-1.5 text-[11px] text-muted-foreground">
                    <History className="mr-1.5 h-3.5 w-3.5" />
                    最近访问
                    <span className="ml-auto">{urlHistory.length}/20</span>
                    <button
                      type="button"
                      className="ml-2 hover:text-destructive"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setUrlHistory([])}
                    >
                      清空
                    </button>
                  </div>
                  {urlHistory.map((url) => (
                    <div key={url} className="group flex items-center rounded-md hover:bg-muted">
                      <button
                        type="button"
                        title={url}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openWebsite(url)}
                        className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs"
                      >
                        {url}
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${url}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setUrlHistory((current) => current.filter((item) => item !== url))}
                        className="mr-1 rounded p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button className="w-full sm:w-auto" onClick={() => openWebsite()}>
              查询并翻译
            </Button>
          </>
        )}
        {mode === "paste" && (
          <>
            <span className="order-3 w-full text-xs text-muted-foreground sm:order-none sm:ml-auto sm:w-auto">
              {wordCount} 词 · {article.length}/30000 字符
            </span>
            <Button className="ml-auto sm:ml-0" disabled={loading} onClick={() => void translateText(article)}>
              <Sparkles className="mr-2 h-4 w-4" />
              翻译文章
            </Button>
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="break-words border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:px-4 sm:text-sm">
          {error}
        </div>
      )}
      {mode === "website" ? (
        <div className="grid grid-cols-1 divide-y lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="relative h-[45vh] min-h-[320px] bg-white lg:h-auto lg:min-h-0">
            {pageUrl ? (
              <>
                <div className="absolute left-2 right-2 top-2 z-10 flex items-center gap-2 rounded-lg border bg-background/95 px-2 py-1 shadow sm:left-auto sm:right-3 sm:top-3">
                  <span className="min-w-0 flex-1 truncate text-xs sm:max-w-56" title={pageTitle}>
                    {pageLoading ? "正在加载网站…" : pageTitle || new URL(pageUrl).hostname}
                  </span>
                  <button title="重新读取并翻译" onClick={() => void extractAndTranslate()} className="rounded p-1 hover:bg-muted">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
                <webview
                  ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
                  src={pageUrl}
                  partition="persist:english-translation"
                  style={{ width: "100%", height: "100%", border: 0 }}
                />
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">网站将在这里打开</div>
            )}
          </div>
          {translationPane}
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="h-[45vh] min-h-[320px] p-3 sm:p-4 lg:h-auto lg:min-h-0">
            <textarea
              value={article}
              maxLength={30000}
              onChange={(event) => setArticle(event.target.value)}
              placeholder="粘贴英文文章，保留原始段落结构…"
              className="h-full min-h-0 w-full resize-none rounded-lg border bg-background p-3 text-sm leading-7 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {translationPane}
        </div>
      )}
    </div>
  );
}
