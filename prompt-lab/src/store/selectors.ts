import { useStore } from './store';
import { useShallow } from 'zustand/shallow';
import { CATEGORIES } from './types';
import type { Prompt } from './types';

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
