import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  RssArticle,
  RssFeed,
  RssKeywordRule,
  RssRuleAction,
  RssSubscription,
} from "./types";
import {
  RECOMMENDED_FEEDS,
  unsubscribedRecommendations,
  type RecommendedFeed,
} from "./recommended-feeds";

interface RssState {
  subscriptions: RssSubscription[];
  articles: RssArticle[];
}
type Filter = "all" | "unread" | "starred";
const STORAGE_KEY = "plugin-rss-reader-v1";
const REFRESH_KEY = "plugin-rss-reader-refresh-minutes";
const RETENTION_KEY = "plugin-rss-reader-retention-days";
const NOTIFICATIONS_KEY = "plugin-rss-reader-notifications";
const FEED_URL_KEY = "plugin-rss-reader-last-url";

function loadState(): RssState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "",
    ) as RssState;
    return Array.isArray(parsed.subscriptions) && Array.isArray(parsed.articles)
      ? parsed
      : { subscriptions: [], articles: [] };
  } catch {
    return { subscriptions: [], articles: [] };
  }
}

function subscriptionId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1)
    hash = Math.imul(hash ^ url.charCodeAt(index), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
}

function mergeFeed(
  state: RssState,
  feed: RssFeed,
  sourceUrl = feed.feedUrl,
): RssState {
  const now = Date.now();
  const id = subscriptionId(feed.feedUrl);
  const previous = new Map(
    state.articles.map((article) => [
      `${article.feedId}:${article.id}`,
      article,
    ]),
  );
  const incoming = feed.items.map((item): RssArticle => {
    const existing = previous.get(`${id}:${item.id}`);
    return {
      ...item,
      feedId: id,
      feedTitle: feed.title,
      read: existing?.read ?? false,
      starred: existing?.starred ?? false,
    };
  });
  const existingSubscription = state.subscriptions.find(
    (item) => item.id === id,
  );
  const subscription: RssSubscription = {
    id,
    title: feed.title,
    description: feed.description,
    siteUrl: feed.siteUrl,
    feedUrl: feed.feedUrl,
    sourceUrl: existingSubscription?.sourceUrl ?? sourceUrl,
    category: existingSubscription?.category ?? "未分类",
    addedAt: existingSubscription?.addedAt ?? now,
    lastFetchedAt: now,
  };
  return {
    subscriptions: [
      ...state.subscriptions.filter((item) => item.id !== id),
      subscription,
    ],
    articles: [
      ...incoming,
      ...state.articles.filter((article) => article.feedId !== id),
    ],
  };
}

function save(
  next: RssState,
  setState: React.Dispatch<React.SetStateAction<RssState>>,
): void {
  setState(next);
  void window.electronAPI.rss.saveState(next);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toOpml(subscriptions: RssSubscription[]): string {
  const groups = new Map<string, RssSubscription[]>();
  for (const feed of subscriptions)
    groups.set(feed.category || "未分类", [
      ...(groups.get(feed.category || "未分类") ?? []),
      feed,
    ]);
  const body = [...groups]
    .map(
      ([category, feeds]) =>
        `    <outline text="${escapeXml(category)}">\n${feeds.map((feed) => `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.feedUrl)}" htmlUrl="${escapeXml(feed.siteUrl)}"/>`).join("\n")}\n    </outline>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>next-work-dashboard RSS subscriptions</title></head><body>\n${body}\n</body></opml>`;
}

function parseOpml(xml: string): Array<{ url: string; category: string }> {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror"))
    throw new Error("OPML 文件格式无效");
  return Array.from(document.querySelectorAll("outline[xmlUrl]"))
    .map((node) => ({
      url: node.getAttribute("xmlUrl") ?? "",
      category: node.parentElement?.getAttribute("text") || "未分类",
    }))
    .filter((item) => !!item.url);
}

function dateLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
      }).format(date);
}

export const RssReaderPanel: React.FC = () => {
  const [state, setState] = useState<RssState>(loadState);
  const [selectedFeed, setSelectedFeed] = useState<string>("all");
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState(
    () => localStorage.getItem(FEED_URL_KEY) ?? "",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshMinutes, setRefreshMinutes] = useState(() =>
    Number(localStorage.getItem(REFRESH_KEY) ?? 60),
  );
  const [retentionDays, setRetentionDays] = useState(() =>
    Number(localStorage.getItem(RETENTION_KEY) ?? 90),
  );
  const [fullTexts, setFullTexts] = useState<
    Record<string, { text: string; markdown: string; wordCount: number }>
  >({});
  const [extracting, setExtracting] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem(NOTIFICATIONS_KEY) === "true",
  );
  const [rules, setRules] = useState<RssKeywordRule[]>([]);
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  useEffect(() => {
    void window.electronAPI.rss.setRefreshMinutes(refreshMinutes);
    void window.electronAPI.rss.setRetentionDays(retentionDays);
    void window.electronAPI.rss.setNotificationsEnabled(notificationsEnabled);
    void window.electronAPI.rss.listRules().then(setRules);
    void window.electronAPI.rss
      .loadState()
      .then((stored) => {
        const legacy = loadState();
        if (!stored.subscriptions.length && legacy.subscriptions.length) {
          const migrated = {
            ...legacy,
            subscriptions: legacy.subscriptions.map((feed) => ({
              ...feed,
              sourceUrl: feed.sourceUrl || feed.feedUrl,
              category: feed.category || "未分类",
            })),
          };
          save(migrated, setState);
          localStorage.removeItem(STORAGE_KEY);
        } else setState(stored);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "无法加载 RSS 数据库",
        ),
      );
    // Initial synchronization only; subsequent setting changes are handled by the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchMatches(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void window.electronAPI.rss
        .search(trimmed)
        .then((matches) =>
          setSearchMatches(
            new Set(matches.map((item) => `${item.feedId}:${item.articleId}`)),
          ),
        );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const visible = useMemo(
    () =>
      state.articles
        .filter(
          (item) => selectedFeed === "all" || item.feedId === selectedFeed,
        )
        .filter(
          (item) =>
            filter === "all" ||
            (filter === "unread" ? !item.read : item.starred),
        )
        .filter(
          (item) =>
            !query.trim() || searchMatches?.has(`${item.feedId}:${item.id}`),
        )
        .sort(
          (a, b) =>
            (Date.parse(b.publishedAt ?? "") || 0) -
            (Date.parse(a.publishedAt ?? "") || 0),
        ),
    [state.articles, selectedFeed, filter, query, searchMatches],
  );
  const current =
    state.articles.find(
      (item) => `${item.feedId}:${item.id}` === selectedArticle,
    ) ?? null;
  const currentSubscription =
    state.subscriptions.find((item) => item.id === selectedFeed) ?? null;
  const unread = (feedId?: string) =>
    state.articles.filter(
      (item) => !item.read && (!feedId || item.feedId === feedId),
    ).length;

  const fetchOne = async (url: string, source = state, category = "未分类") => {
    const feed = await window.electronAPI.rss.fetch(url);
    const normalizedSourceUrl = new URL(url).toString();
    const merged = mergeFeed(source, feed, normalizedSourceUrl);
    const id = subscriptionId(feed.feedUrl);
    return {
      ...merged,
      subscriptions: merged.subscriptions.map((item) =>
        item.id === id
          ? {
              ...item,
              sourceUrl: item.sourceUrl || normalizedSourceUrl,
              category,
            }
          : item,
      ),
    };
  };
  const addFeed = async () => {
    if (!feedUrl.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await fetchOne(feedUrl.trim());
      const added = next.subscriptions.find(
        (item) => item.sourceUrl === new URL(feedUrl.trim()).toString(),
      );
      save(next, setState);
      setSelectedFeed(added?.id ?? "all");
      localStorage.setItem(FEED_URL_KEY, feedUrl.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加订阅失败");
    } finally {
      setBusy(false);
    }
  };
  const addRecommendedFeeds = async (feeds: RecommendedFeed[]) => {
    if (!feeds.length) return;
    setBusy(true);
    setError("");
    let next = state;
    const failures: string[] = [];
    try {
      for (let index = 0; index < feeds.length; index += 1) {
        const feed = feeds[index];
        setImportProgress(`${index + 1}/${feeds.length} · ${feed.title}`);
        try {
          next = await fetchOne(feed.url, next, feed.category);
          save(next, setState);
        } catch {
          failures.push(feed.title);
        }
      }
      if (failures.length)
        setError(`已添加 ${feeds.length - failures.length} 个，${failures.join("、")} 添加失败`);
      else setCatalogOpen(false);
    } finally {
      setImportProgress("");
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.electronAPI.rss.refreshAll();
      setState(next);
      const failures = next.subscriptions
        .filter((feed) => feed.error)
        .map((feed) => feed.title);
      if (failures.length) setError(`${failures.join("、")} 刷新失败`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  };

  const importOpml = async () => {
    const picked = await window.electronAPI.pickFile({ accept: ".opml,.xml" });
    const file = Array.isArray(picked) ? picked[0] : picked;
    if (!file?.text) return;
    setBusy(true);
    setError("");
    let next = state;
    try {
      for (const entry of parseOpml(file.text))
        next = await fetchOne(entry.url, next, entry.category);
      save(next, setState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OPML 导入失败");
    } finally {
      setBusy(false);
    }
  };
  const exportOpml = () => {
    void window.electronAPI.saveFile(
      toOpml(state.subscriptions),
      "rss-subscriptions.opml",
    );
  };
  const patchArticle = (article: RssArticle, patch: Partial<RssArticle>) =>
    save(
      {
        ...state,
        articles: state.articles.map((item) =>
          item.feedId === article.feedId && item.id === article.id
            ? { ...item, ...patch }
            : item,
        ),
      },
      setState,
    );
  const openArticle = (article: RssArticle) => {
    patchArticle(article, { read: true });
    setSelectedArticle(`${article.feedId}:${article.id}`);
    if (article.link && !fullTexts[`${article.feedId}:${article.id}`]) void loadFullText(article);
  };
  const markVisibleRead = () => {
    const keys = new Set(
      visible.map((article) => `${article.feedId}:${article.id}`),
    );
    save(
      {
        ...state,
        articles: state.articles.map((article) =>
          keys.has(`${article.feedId}:${article.id}`)
            ? { ...article, read: true }
            : article,
        ),
      },
      setState,
    );
  };
  const loadFullText = async (article: RssArticle) => {
    if (!article.link) return;
    const key = `${article.feedId}:${article.id}`;
    setExtracting(true);
    setError("");
    try {
      const extracted = await window.electronAPI.rss.extractArticle(
        article.feedId,
        article.id,
        article.link,
      );
      setFullTexts((currentTexts) => ({ ...currentTexts, [key]: extracted }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "正文提取失败");
    } finally {
      setExtracting(false);
    }
  };
  const addRule = async () => {
    const name = window.prompt("规则名称");
    if (!name?.trim()) return;
    const include =
      window.prompt("包含关键词（逗号分隔，任意一个匹配）", "") ?? "";
    const exclude = window.prompt("排除关键词（逗号分隔）", "") ?? "";
    const rawAction = window.prompt(
      "动作：notify / star / mark-read",
      "notify",
    );
    const action: RssRuleAction =
      rawAction === "star" || rawAction === "mark-read" ? rawAction : "notify";
    const rule: RssKeywordRule = {
      id: `rule-${Date.now().toString(36)}`,
      name: name.trim(),
      includeKeywords: include
        .split(/[,，]/)
        .map((word) => word.trim())
        .filter(Boolean),
      excludeKeywords: exclude
        .split(/[,，]/)
        .map((word) => word.trim())
        .filter(Boolean),
      action,
      enabled: true,
    };
    await window.electronAPI.rss.saveRule(rule);
    setRules((currentRules) => [...currentRules, rule]);
  };
  const updateRule = (rule: RssKeywordRule) => {
    void window.electronAPI.rss.saveRule(rule);
    setRules((currentRules) =>
      currentRules.map((item) => (item.id === rule.id ? rule : item)),
    );
  };
  const removeRule = (id: string) => {
    void window.electronAPI.rss.deleteRule(id);
    setRules((currentRules) => currentRules.filter((item) => item.id !== id));
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      const index = current
        ? visible.findIndex(
            (article) =>
              article.feedId === current.feedId && article.id === current.id,
          )
        : -1;
      if (event.key.toLowerCase() === "j" && visible.length) {
        event.preventDefault();
        openArticle(visible[Math.min(index + 1, visible.length - 1)]);
      } else if (event.key.toLowerCase() === "k" && visible.length) {
        event.preventDefault();
        openArticle(visible[Math.max(index - 1, 0)]);
      } else if (event.key.toLowerCase() === "s" && current) {
        event.preventDefault();
        patchArticle(current, { starred: !current.starred });
      } else if (event.key.toLowerCase() === "r" && current) {
        event.preventDefault();
        patchArticle(current, { read: !current.read });
      } else if (event.key.toLowerCase() === "o" && current?.link) {
        event.preventDefault();
        void window.electronAPI.shell.openExternal(current.link);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  return (
    <div className="flex h-full min-h-0 bg-card text-foreground">
      <aside className="w-72 shrink-0 border-r flex flex-col min-h-0 bg-card">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 font-semibold">
            <Globe className="h-5 w-5 text-primary" />
            RSS 阅读器
          </div>
          <div className="flex gap-1 mt-3">
            <Input
              value={feedUrl}
              onChange={(event) => {
                setFeedUrl(event.target.value);
                localStorage.setItem(FEED_URL_KEY, event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addFeed();
              }}
              placeholder="粘贴 RSS / Atom 地址"
              className="h-8 text-xs"
              title={feedUrl}
            />
            <Button
              size="sm"
              className="h-8 px-2"
              disabled={busy}
              onClick={() => void addFeed()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs text-muted-foreground">订阅源</span>
          <div className="flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => void importOpml()}
              title="导入 OPML"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={!state.subscriptions.length}
              onClick={exportOpml}
              title="导出 OPML"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={busy || !state.subscriptions.length}
              onClick={() => void refresh()}
              title="刷新全部"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
        <div className="border-b">
          <button
            className="w-full px-3 py-2 text-left hover:bg-muted/40"
            onClick={() => setCatalogOpen((open) => !open)}
          >
            <span className="flex items-center justify-between text-xs font-medium">
              <span>发现优质订阅</span>
              <span className="text-primary">{catalogOpen ? "收起" : "浏览"}</span>
            </span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              来自 Tidings RSS 已验证精选源
            </span>
          </button>
          {catalogOpen && (() => {
            const available = unsubscribedRecommendations(
              state.subscriptions.flatMap((feed) => [feed.feedUrl, feed.sourceUrl]),
            );
            return (
              <div className="max-h-64 overflow-auto border-t bg-muted/20 px-2 py-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[10px] text-muted-foreground">
                    {available.length} 个可添加
                  </span>
                  <button
                    className="text-[11px] text-primary disabled:opacity-50"
                    disabled={busy || !available.length}
                    onClick={() => void addRecommendedFeeds(available)}
                  >
                    全部添加
                  </button>
                </div>
                {importProgress && (
                  <div className="mb-2 truncate rounded bg-primary/10 px-2 py-1 text-[10px] text-primary">
                    正在添加 {importProgress}
                  </div>
                )}
                {RECOMMENDED_FEEDS.map((feed) => {
                  const added = !available.includes(feed);
                  return (
                    <div key={feed.url} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">{feed.title}</div>
                        <div className="truncate text-[9px] text-muted-foreground">
                          {feed.category} · {feed.language}
                        </div>
                      </div>
                      <button
                        className="shrink-0 text-[10px] text-primary disabled:text-muted-foreground"
                        disabled={busy || added}
                        onClick={() => void addRecommendedFeeds([feed])}
                      >
                        {added ? "已添加" : "+ 添加"}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        {currentSubscription && (
          <div className="px-3 py-2 border-b bg-muted/30">
            <div className="text-[10px] text-muted-foreground mb-1">
              已保存的 RSS 地址
            </div>
            <div className="flex items-center gap-1">
              <button
                className="min-w-0 flex-1 truncate text-left text-[11px] text-primary hover:underline"
                title={currentSubscription.sourceUrl}
                onClick={() =>
                  void window.electronAPI.shell.openExternal(
                    currentSubscription.sourceUrl,
                  )
                }
              >
                {currentSubscription.sourceUrl}
              </button>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground"
                title="复制地址"
                onClick={() =>
                  window.electronAPI.copyText(currentSubscription.sourceUrl)
                }
              >
                复制
              </button>
            </div>
            {currentSubscription.sourceUrl !== currentSubscription.feedUrl && (
              <div
                className="mt-1 truncate text-[10px] text-muted-foreground"
                title={currentSubscription.feedUrl}
              >
                发现源：{currentSubscription.feedUrl}
              </div>
            )}
          </div>
        )}
        <details className="border-b group">
          <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/40">
            <span>阅读器设置</span>
            <span className="transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">后台刷新</span>
            <select
              className="text-xs bg-background border rounded px-1 py-0.5"
              value={refreshMinutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRefreshMinutes(value);
                localStorage.setItem(REFRESH_KEY, String(value));
                void window.electronAPI.rss.setRefreshMinutes(value);
              }}
            >
              <option value={0}>关闭</option>
              <option value={15}>15 分钟</option>
              <option value={60}>1 小时</option>
              <option value={240}>4 小时</option>
            </select>
          </div>
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">文章保留</span>
            <select
              className="text-xs bg-background border rounded px-1 py-0.5"
              value={retentionDays}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRetentionDays(value);
                localStorage.setItem(RETENTION_KEY, String(value));
                void window.electronAPI.rss
                  .setRetentionDays(value)
                  .then(() => window.electronAPI.rss.loadState())
                  .then(setState);
              }}
            >
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={180}>180 天</option>
              <option value={0}>永久</option>
            </select>
          </div>
          <label className="px-3 py-2 border-b flex items-center justify-between text-[11px] text-muted-foreground">
            <span>桌面通知</span>
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setNotificationsEnabled(enabled);
                localStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
                void window.electronAPI.rss.setNotificationsEnabled(enabled);
              }}
            />
          </label>
          <div className="px-3 py-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                关键词规则
              </span>
              <button
                className="text-xs text-primary"
                onClick={() => void addRule()}
              >
                + 添加
              </button>
            </div>
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-1 mt-1 text-[10px]"
                title={`${rule.includeKeywords.join("、")} → ${rule.action}`}
              >
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) =>
                    updateRule({ ...rule, enabled: event.target.checked })
                  }
                />
                <span className="truncate flex-1">{rule.name}</span>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeRule(rule.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
        <div className="overflow-auto flex-1 p-2 space-y-1">
          <button
            onClick={() => setSelectedFeed("all")}
            className={`w-full rounded px-2 py-2 text-left text-sm flex justify-between ${selectedFeed === "all" ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            <span>全部文章</span>
            <span>{unread()}</span>
          </button>
          {state.subscriptions.map((feed) => (
            <div
              key={feed.id}
              title={
                feed.error ||
                `最后成功：${new Date(feed.lastFetchedAt).toLocaleString()}`
              }
              className={`group rounded flex items-center ${selectedFeed === feed.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
            >
              <span
                className={`ml-2 h-2 w-2 rounded-full shrink-0 ${feed.error ? "bg-destructive" : "bg-green-500"}`}
              />
              <button
                onClick={() => {
                  setSelectedFeed(feed.id);
                  setFeedUrl(feed.sourceUrl);
                  localStorage.setItem(FEED_URL_KEY, feed.sourceUrl);
                }}
                className="flex-1 min-w-0 px-2 py-2 text-left text-sm"
              >
                <span className="block truncate">{feed.title}</span>
                <span
                  className={`text-[10px] ${feed.error ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {feed.error ? "刷新失败" : feed.category} · {unread(feed.id)}{" "}
                  未读
                </span>
                <span className="block truncate text-[9px] text-muted-foreground/70 mt-0.5">
                  {feed.sourceUrl}
                </span>
              </button>
              <button
                title="修改分类"
                className="px-1 text-[10px] opacity-0 group-hover:opacity-100 text-muted-foreground"
                onClick={() => {
                  const category = window.prompt("订阅分类", feed.category);
                  if (category?.trim())
                    save(
                      {
                        ...state,
                        subscriptions: state.subscriptions.map((item) =>
                          item.id === feed.id
                            ? { ...item, category: category.trim() }
                            : item,
                        ),
                      },
                      setState,
                    );
                }}
              >
                分类
              </button>
              <button
                title="删除订阅"
                className="p-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  const next = {
                    subscriptions: state.subscriptions.filter(
                      (item) => item.id !== feed.id,
                    ),
                    articles: state.articles.filter(
                      (item) => item.feedId !== feed.id,
                    ),
                  };
                  save(next, setState);
                  if (selectedFeed === feed.id) setSelectedFeed("all");
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!state.subscriptions.length && (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              添加一个订阅源开始阅读
            </p>
          )}
        </div>
      </aside>
      <section className="w-[360px] shrink-0 border-r flex flex-col min-h-0 bg-card">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文章"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex gap-1 items-center">
            {(["all", "unread", "starred"] as Filter[]).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "全部"
                  : value === "unread"
                    ? "未读"
                    : "收藏"}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 ml-auto px-2"
              disabled={!visible.some((article) => !article.read)}
              onClick={markVisibleRead}
              title="将当前列表全部标为已读"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          {visible.map((article) => (
            <button
              key={`${article.feedId}:${article.id}`}
              onClick={() => openArticle(article)}
              className={`w-full border-b p-3 text-left hover:bg-muted/60 ${!article.read ? "bg-primary/5" : ""}`}
            >
              <div className="flex gap-2">
                <span
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${article.read ? "bg-transparent" : "bg-primary"}`}
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium line-clamp-2">
                    {article.title}
                  </h3>
                  <div className="flex justify-between gap-2 mt-1 text-[11px] text-muted-foreground">
                    <span className="truncate">{article.feedTitle}</span>
                    <span className="shrink-0">
                      {dateLabel(article.publishedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
          {!visible.length && (
            <p className="text-center text-xs text-muted-foreground py-12">
              没有符合条件的文章
            </p>
          )}
        </div>
      </section>
      <main className="flex-1 min-w-0 overflow-auto bg-background/30">
        {current ? (
          <article className="w-full max-w-[980px] mx-auto px-12 py-10">
            <header className="pb-7 mb-8 border-b">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-medium text-primary mb-3">
                    {current.feedTitle}
                  </p>
                  <h1 className="text-3xl font-semibold leading-[1.3] tracking-tight">
                    {current.title}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-4">
                    {[current.author, dateLabel(current.publishedAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patchArticle(current, { starred: !current.starred })
                  }
                  title={current.starred ? "取消收藏" : "收藏"}
                >
                  <Star
                    className={`h-5 w-5 ${current.starred ? "text-warning fill-current" : ""}`}
                  />
                </Button>
              </div>
            </header>
            {fullTexts[`${current.feedId}:${current.id}`]?.markdown ? (
              <div className="prose prose-slate dark:prose-invert max-w-none prose-p:text-[16px] prose-p:leading-8 prose-p:my-5 prose-headings:mt-9 prose-headings:mb-4 prose-a:text-primary prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        onClick={(event) => {
                          event.preventDefault();
                          if (href)
                            void window.electronAPI.shell.openExternal(href);
                        }}
                      >
                        {children}
                      </a>
                    ),
                    img: () => null,
                  }}
                >
                  {fullTexts[`${current.feedId}:${current.id}`].markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-[16px] leading-8 whitespace-pre-wrap text-foreground/80">
                {current.description || "该订阅源没有提供摘要。"}
              </div>
            )}
            {fullTexts[`${current.feedId}:${current.id}`] && (
              <p className="mt-8 pt-4 border-t text-xs text-muted-foreground">
                正文已离线保存 ·{" "}
                {fullTexts[`${current.feedId}:${current.id}`].wordCount} 词
              </p>
            )}
            <div className="mt-8 flex gap-2">
              {current.link &&
                !fullTexts[`${current.feedId}:${current.id}`] && (
                  <Button
                    variant="outline"
                    disabled={extracting}
                    onClick={() => void loadFullText(current)}
                  >
                    {extracting ? <Loader2 className="mr-2 h-4 w-4" /> : null}
                    提取并离线保存全文
                  </Button>
                )}
              {current.link && (
                <Button
                  onClick={() =>
                    window.electronAPI.shell.openExternal(current.link)
                  }
                >
                  阅读原文 <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </article>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            选择一篇文章开始阅读
          </div>
        )}
      </main>
    </div>
  );
};
