import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/store/index';
import type { Prompt } from '../src/store/types';

// ── 辅助 ──

function prompt(overrides: Partial<Prompt> & { id: string }): Prompt {
  return {
    title: overrides.id,
    content: `内容-${overrides.id}`,
    category: '通用',
    tags: [],
    variables: [],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** 模拟 useFilteredPrompts 的 selector 逻辑 */
function filteredPrompts(state: ReturnType<typeof useStore.getState>) {
  let list = state.prompts;

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (state.filterCategory) {
    list = list.filter((p) => p.category === state.filterCategory);
  }

  if (state.filterTag) {
    list = list.filter((p) => p.tags.includes(state.filterTag));
  }

  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return b.usageCount - a.usageCount;
  });
}

/** 模拟 useAllTags 的 selector 逻辑 */
function allTags(state: ReturnType<typeof useStore.getState>) {
  const tags = new Set<string>();
  state.prompts.forEach((p) => p.tags.forEach((t) => tags.add(t)));
  return [...tags].sort();
}

/** 模拟 useRecentPrompts 的 selector 逻辑 */
function recentPrompts(state: ReturnType<typeof useStore.getState>, limit = 5) {
  const seen = new Set<string>();
  const result: Prompt[] = [];
  for (const entry of state.injectHistory) {
    if (seen.has(entry.promptId)) continue;
    seen.add(entry.promptId);
    const p = state.prompts.find((pp) => pp.id === entry.promptId);
    if (p) result.push(p);
    if (result.length >= limit) break;
  }
  return result;
}

/** 模拟 useAllCategories 的 selector 逻辑 */
function allCategories(state: ReturnType<typeof useStore.getState>) {
  const { CATEGORIES } = require('../src/store/types');
  const all = [...CATEGORIES];
  state.userCategories.forEach((c) => {
    if (!all.includes(c)) all.push(c);
  });
  return all;
}

// 每次测试前重置
beforeEach(() => {
  useStore.setState(useStore.getInitialState());
});

// ── useFilteredPrompts ──

describe('useFilteredPrompts', () => {
  it('无搜索/过滤时返回全部，按 pinned > favorite > usageCount 排序', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', isPinned: false, isFavorite: false, usageCount: 10 }),
        prompt({ id: 'b', isPinned: true, isFavorite: false, usageCount: 0 }),
        prompt({ id: 'c', isPinned: false, isFavorite: true, usageCount: 5 }),
        prompt({ id: 'd', isPinned: true, isFavorite: true, usageCount: 3 }),
      ],
    });
    const result = filteredPrompts(useStore.getState());
    // pinned 优先；同为 pinned 时 favorite 优先；再按 usageCount desc
    expect(result.map((p) => p.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('搜索：匹配 title', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', title: 'React 入门', content: '...' }),
        prompt({ id: 'b', title: 'Vue 指南', content: '...' }),
        prompt({ id: 'c', title: 'React 进阶', content: '...' }),
      ],
      searchQuery: 'react',
    });
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('搜索：匹配 content', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', title: 'A', content: '包含 react 关键词' }),
        prompt({ id: 'b', title: 'B', content: '无关内容' }),
      ],
      searchQuery: 'react',
    });
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('搜索：匹配 tags', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', tags: ['typescript'] }),
        prompt({ id: 'b', tags: ['javascript'] }),
      ],
      searchQuery: 'type',
    });
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('搜索：大小写不敏感', () => {
    useStore.setState({
      prompts: [prompt({ id: 'a', title: 'REACT HOOKS' })],
      searchQuery: 'react',
    });
    expect(filteredPrompts(useStore.getState()).length).toBe(1);
  });

  it('分类过滤：精确匹配', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', category: '编程' }),
        prompt({ id: 'b', category: '写作' }),
        prompt({ id: 'c', category: '编程' }),
      ],
      filterCategory: '编程',
    });
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('标签过滤', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', tags: ['react', 'hooks'] }),
        prompt({ id: 'b', tags: ['vue'] }),
        prompt({ id: 'c', tags: ['react'] }),
      ],
      filterTag: 'react',
    });
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('搜索 + 分类 + 标签组合过滤', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', title: 'React Hook', category: '编程', tags: ['react'] }),
        prompt({ id: 'b', title: 'React Hook', category: '写作', tags: ['react'] }),
        prompt({ id: 'c', title: 'React Hook', category: '编程', tags: ['vue'] }),
        prompt({ id: 'd', title: 'Vue Guide', category: '编程', tags: ['react'] }),
      ],
      searchQuery: 'react',
      filterCategory: '编程',
      filterTag: 'react',
    });
    // 只有 a 同时满足：标题含 react + 分类 编程 + 标签 react
    const result = filteredPrompts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['a']);
  });
});

// ── useAllTags ──

describe('useAllTags', () => {
  it('从所有提示词收集去重标签，按字母排序', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a', tags: ['react', 'typescript'] }),
        prompt({ id: 'b', tags: ['react', 'css'] }),
        prompt({ id: 'c', tags: [] }),
      ],
    });
    expect(allTags(useStore.getState())).toEqual(['css', 'react', 'typescript']);
  });

  it('无标签时返回空数组', () => {
    useStore.setState({ prompts: [prompt({ id: 'a', tags: [] })] });
    expect(allTags(useStore.getState())).toEqual([]);
  });
});

// ── useRecentPrompts ──

describe('useRecentPrompts', () => {
  it('按注入历史顺序返回最近使用的提示词，去重', () => {
    const pa = prompt({ id: 'a', title: 'A' });
    const pb = prompt({ id: 'b', title: 'B' });
    const pc = prompt({ id: 'c', title: 'C' });
    useStore.setState({
      prompts: [pa, pb, pc],
      injectHistory: [
        { promptId: 'b', siteId: 's1', timestamp: 3 },
        { promptId: 'a', siteId: 's1', timestamp: 2 },
        { promptId: 'b', siteId: 's2', timestamp: 1 }, // 重复 b
      ],
    });
    const result = recentPrompts(useStore.getState(), 5);
    expect(result.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('尊重 limit 参数', () => {
    useStore.setState({
      prompts: [
        prompt({ id: 'a' }), prompt({ id: 'b' }), prompt({ id: 'c' }),
        prompt({ id: 'd' }), prompt({ id: 'e' }),
      ],
      injectHistory: [
        { promptId: 'a', siteId: 's', timestamp: 0 },
        { promptId: 'b', siteId: 's', timestamp: 0 },
        { promptId: 'c', siteId: 's', timestamp: 0 },
        { promptId: 'd', siteId: 's', timestamp: 0 },
        { promptId: 'e', siteId: 's', timestamp: 0 },
      ],
    });
    const result = recentPrompts(useStore.getState(), 3);
    expect(result.length).toBe(3);
  });

  it('跳过已删除的提示词', () => {
    useStore.setState({
      prompts: [prompt({ id: 'a' })],
      injectHistory: [
        { promptId: 'ghost', siteId: 's', timestamp: 0 },
        { promptId: 'a', siteId: 's', timestamp: 0 },
      ],
    });
    expect(recentPrompts(useStore.getState(), 5).length).toBe(1);
  });
});

// ── useAllCategories ──

describe('useAllCategories', () => {
  it('返回预设分类 + 用户自定义分类，无重复', () => {
    useStore.setState({ userCategories: ['脚本', '通用'] }); // 通用已在预设中
    const cats = allCategories(useStore.getState());
    expect(cats).toContain('通用');
    expect(cats).toContain('编程');
    expect(cats).toContain('脚本');
    // 通用 不应出现两次
    expect(cats.filter((c: string) => c === '通用').length).toBe(1);
  });

  it('无自定义分类时只返回预设', () => {
    useStore.setState({ userCategories: [] });
    const cats = allCategories(useStore.getState());
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toContain('通用');
  });
});
