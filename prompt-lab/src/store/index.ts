import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import type { Prompt, PromptVariable, SiteConfig, Tab, InjectMode, InjectStrategy } from './types';
import { DEFAULT_SITES, CATEGORIES } from './types';
import { DEFAULT_PROMPTS } from './defaultPrompts';

// ── Store 类型 ──

interface AppState {
  // ── 提示词 ──
  prompts: Prompt[];
  selectedPromptId: string | null;
  searchQuery: string;
  filterCategory: string | null;
  filterTag: string | null;
  addPrompt: (p: Prompt) => void;
  updatePrompt: (id: string, patch: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;
  batchDeletePrompts: (ids: string[]) => void;
  selectPrompt: (id: string | null) => void;
  setSearch: (q: string) => void;
  setFilterCategory: (c: string | null) => void;
  setFilterTag: (t: string | null) => void;
  incrementUsage: (id: string) => void;

  // ── 注入历史 ──
  injectHistory: { promptId: string; siteId: string; timestamp: number }[];
  recordInject: (promptId: string, siteId: string) => void;

  // ── 站点 ──
  sites: SiteConfig[];
  updateSite: (id: string, patch: Partial<SiteConfig>) => void;
  addSite: (site: SiteConfig) => void;

  // ── 标签页 ──
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (siteId: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // ── 注入 ──
  injectMode: InjectMode;
  setInjectMode: (mode: InjectMode) => void;
  injectStrategy: InjectStrategy;
  setInjectStrategy: (s: InjectStrategy) => void;
  lastInjectResult: { success: boolean; error?: string } | null;
  setLastInjectResult: (r: { success: boolean; error?: string } | null) => void;

  // ── UI ──
  activeActivity: 'ai' | 'prompts' | 'settings' | 'history' | null;
  setActiveActivity: (a: 'ai' | 'prompts' | 'settings' | 'history' | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  userCategories: string[];
  addCategory: (c: string) => void;

  // 浮动面板注入信号
  pendingInjection: { promptId: string; siteId: string } | null;
  triggerInjection: (promptId: string, siteId: string) => void;
  clearInjection: () => void;

  // 提示词抽屉
  promptDrawerOpen: boolean;
  setPromptDrawerOpen: (open: boolean) => void;

  // 对话保存信号 — 每次保存递增，历史面板监听此值以刷新列表
  conversationSavedAt: number;
  notifyConversationSaved: () => void;
}

// ── 辅助 ──

let idCounter = 10;
const genId = () => `${Date.now()}-${idCounter++}`;

// ── Store ──

export const useStore = create<AppState>((set, get) => ({
  // ── 提示词 ──
  prompts: DEFAULT_PROMPTS,
  selectedPromptId: null,
  searchQuery: '',
  filterCategory: null,
  filterTag: null,

  addPrompt: (p) => set((s) => ({ prompts: [...s.prompts, p] })),

  updatePrompt: (id, patch) =>
    set((s) => ({
      prompts: s.prompts.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
      ),
    })),

  deletePrompt: (id) =>
    set((s) => ({
      prompts: s.prompts.filter((p) => p.id !== id),
      selectedPromptId: s.selectedPromptId === id ? null : s.selectedPromptId,
    })),

  batchDeletePrompts: (ids) =>
    set((s) => ({
      prompts: s.prompts.filter((p) => !ids.includes(p.id)),
      selectedPromptId: ids.includes(s.selectedPromptId ?? '') ? null : s.selectedPromptId,
    })),

  selectPrompt: (id) => set({ selectedPromptId: id }),

  setSearch: (q) => set({ searchQuery: q }),
  setFilterCategory: (c) => set({ filterCategory: c }),
  setFilterTag: (t) => set({ filterTag: t }),

  incrementUsage: (id) =>
    set((s) => ({
      prompts: s.prompts.map((p) =>
        p.id === id ? { ...p, usageCount: p.usageCount + 1 } : p
      ),
    })),

  // ── 注入历史 ──
  injectHistory: [],
  recordInject: (promptId, siteId) =>
    set((s) => ({
      injectHistory: [
        { promptId, siteId, timestamp: Date.now() },
        ...s.injectHistory,
      ].slice(0, 100), // 只保留最近 100 条
    })),

  // ── 站点 ──
  sites: DEFAULT_SITES,
  updateSite: (id, patch) =>
    set((s) => ({
      sites: s.sites.map((site) =>
        site.id === id ? { ...site, ...patch } : site
      ),
    })),
  addSite: (site) => set((s) => ({ sites: [...s.sites, site] })),

  // ── 标签页 ──
  tabs: [],
  activeTabId: null,

  openTab: (siteId) => {
    const site = get().sites.find((s) => s.id === siteId);
    if (!site) return;
    const tab: Tab = {
      id: genId(),
      siteId,
      title: site.name,
      url: site.url,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        s.activeTabId === tabId
          ? tabs[tabs.length - 1]?.id ?? null
          : s.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  // ── 注入 ──
  injectMode: 'fill-only',
  setInjectMode: (mode) => set({ injectMode: mode }),
  injectStrategy: 'replace',
  setInjectStrategy: (strategy) => set({ injectStrategy: strategy }),
  lastInjectResult: null,
  setLastInjectResult: (r) => set({ lastInjectResult: r }),

  // ── UI ──
  activeActivity: 'ai' as 'ai' | 'prompts' | 'settings' | 'history' | null,
  setActiveActivity: (activeActivity) => set({ activeActivity }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  theme: 'system' as const,
  setTheme: (theme) => set({ theme }),
  userCategories: [],
  addCategory: (c) =>
    set((s) =>
      s.userCategories.includes(c) ? s : { userCategories: [...s.userCategories, c] }
    ),

  pendingInjection: null,
  triggerInjection: (promptId, siteId) => set({ pendingInjection: { promptId, siteId } }),
  clearInjection: () => set({ pendingInjection: null }),

  promptDrawerOpen: false,
  setPromptDrawerOpen: (open) => set({ promptDrawerOpen: open }),

  conversationSavedAt: 0,
  notifyConversationSaved: () => set({ conversationSavedAt: Date.now() }),
}));

// ── 派生选择器 ──

export function useFilteredPrompts() {
  return useStore(useShallow((s) => {
    let list = s.prompts;

    if (s.searchQuery) {
      const q = s.searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (s.filterCategory) {
      list = list.filter((p) => p.category === s.filterCategory);
    }

    if (s.filterTag) {
      list = list.filter((p) => p.tags.includes(s.filterTag));
    }

    // 排序：置顶优先 → 收藏优先 → 使用次数降序
    return [...list].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return b.usageCount - a.usageCount;
    });
  }));
}

export function useAllTags() {
  return useStore(useShallow((s) => {
    const tags = new Set<string>();
    s.prompts.forEach((p) => p.tags.forEach((t) => tags.add(t)));
    return [...tags].sort();
  }));
}

export function useRecentPrompts(limit = 5) {
  return useStore(useShallow((s) => {
    const seen = new Set<string>();
    const result: Prompt[] = [];
    for (const entry of s.injectHistory) {
      if (seen.has(entry.promptId)) continue;
      seen.add(entry.promptId);
      const p = s.prompts.find((pp) => pp.id === entry.promptId);
      if (p) result.push(p);
      if (result.length >= limit) break;
    }
    return result;
  }));
}

export function useAllCategories() {
  return useStore(useShallow((s) => {
    const all = [...CATEGORIES];
    s.userCategories.forEach((c) => { if (!all.includes(c)) all.push(c); });
    return all;
  }));
}

export { CATEGORIES };
export type { Prompt, PromptVariable, SiteConfig, Tab, InjectMode };
