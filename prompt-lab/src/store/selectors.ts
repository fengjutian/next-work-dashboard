import { useStore } from './store';
import { useShallow } from 'zustand/shallow';
import { CATEGORIES } from './types';
import type { Prompt } from './types';

// ── 派生选择器 ──

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
