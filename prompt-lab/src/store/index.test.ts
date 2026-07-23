import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './index';
import type { Prompt } from './types';

// 辅助：构造一个测试 Prompt
function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'test-1',
    title: '测试提示词',
    content: '这是一个测试 {{var}}',
    category: '通用',
    tags: ['测试'],
    variables: [{ name: 'var', defaultValue: '', description: '' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// 每个测试前重置 store 到初始状态
beforeEach(() => {
  useStore.setState(useStore.getInitialState());
});

// ── 提示词 CRUD ──

describe('提示词 CRUD', () => {
  it('addPrompt — 添加一个提示词', () => {
    const initialCount = useStore.getState().prompts.length;
    const p = makePrompt({ id: 'new-1' });
    useStore.getState().addPrompt(p);
    expect(useStore.getState().prompts.length).toBe(initialCount + 1);
    expect(useStore.getState().prompts.find((x) => x.id === 'new-1')).toBeTruthy();
  });

  it('updatePrompt — 更新已有提示词', () => {
    const p = makePrompt({ id: 'new-1' });
    useStore.getState().addPrompt(p);
    useStore.getState().updatePrompt('new-1', { title: '改名了' });
    const updated = useStore.getState().prompts.find((x) => x.id === 'new-1');
    expect(updated?.title).toBe('改名了');
    expect(updated?.updatedAt).toBeGreaterThan(p.updatedAt);
  });

  it('updatePrompt — 不存在的 id 不报错', () => {
    const countBefore = useStore.getState().prompts.length;
    useStore.getState().updatePrompt('不存在的-id', { title: 'x' });
    expect(useStore.getState().prompts.length).toBe(countBefore);
  });

  it('deletePrompt — 删除提示词并清除选中状态', () => {
    const p = makePrompt({ id: 'del-1' });
    useStore.getState().addPrompt(p);
    useStore.getState().selectPrompt('del-1');
    expect(useStore.getState().selectedPromptId).toBe('del-1');

    useStore.getState().deletePrompt('del-1');
    expect(useStore.getState().prompts.find((x) => x.id === 'del-1')).toBeUndefined();
    expect(useStore.getState().selectedPromptId).toBeNull();
  });

  it('deletePrompt — 删除非选中提示词不改变选中状态', () => {
    const a = makePrompt({ id: 'a' });
    const b = makePrompt({ id: 'b' });
    useStore.getState().addPrompt(a);
    useStore.getState().addPrompt(b);
    useStore.getState().selectPrompt('a');
    useStore.getState().deletePrompt('b');
    expect(useStore.getState().selectedPromptId).toBe('a');
  });

  it('batchDeletePrompts — 批量删除', () => {
    useStore.getState().addPrompt(makePrompt({ id: 'x1' }));
    useStore.getState().addPrompt(makePrompt({ id: 'x2' }));
    useStore.getState().addPrompt(makePrompt({ id: 'x3' }));
    useStore.getState().selectPrompt('x2');
    useStore.getState().batchDeletePrompts(['x1', 'x2']);
    expect(useStore.getState().prompts.find((x) => x.id === 'x1')).toBeUndefined();
    expect(useStore.getState().prompts.find((x) => x.id === 'x2')).toBeUndefined();
    expect(useStore.getState().prompts.find((x) => x.id === 'x3')).toBeTruthy();
    expect(useStore.getState().selectedPromptId).toBeNull();
  });
});

// ── 搜索 & 过滤 ──

describe('搜索 & 过滤', () => {
  it('setSearch / setFilterCategory / setFilterTag', () => {
    useStore.getState().setSearch('hello');
    expect(useStore.getState().searchQuery).toBe('hello');

    useStore.getState().setFilterCategory('编程');
    expect(useStore.getState().filterCategory).toBe('编程');
    useStore.getState().setFilterCategory(null);
    expect(useStore.getState().filterCategory).toBeNull();

    useStore.getState().setFilterTag('react');
    expect(useStore.getState().filterTag).toBe('react');
    useStore.getState().setFilterTag(null);
    expect(useStore.getState().filterTag).toBeNull();
  });
});

// ── incrementUsage ──

describe('incrementUsage', () => {
  it('点击次数正确递增', () => {
    const p = makePrompt({ id: 'u1', usageCount: 5 });
    useStore.getState().addPrompt(p);
    useStore.getState().incrementUsage('u1');
    useStore.getState().incrementUsage('u1');
    const updated = useStore.getState().prompts.find((x) => x.id === 'u1');
    expect(updated?.usageCount).toBe(7);
  });

  it('不存在的 id 不影响任何提示词', () => {
    const before = useStore.getState().prompts;
    useStore.getState().incrementUsage('ghost');
    expect(useStore.getState().prompts).toEqual(before);
  });
});

// ── 注入历史 ──

describe('注入历史', () => {
  it('recordInject — 记录注入历史，最新的在最前', () => {
    useStore.getState().recordInject('pA', 'site1');
    useStore.getState().recordInject('pB', 'site2');
    const history = useStore.getState().injectHistory;
    expect(history.length).toBe(2);
    expect(history[0].promptId).toBe('pB');
    expect(history[1].promptId).toBe('pA');
  });

  it('recordInject — 超过 100 条时只保留最近 100 条', () => {
    for (let i = 0; i < 150; i++) {
      useStore.getState().recordInject(`p${i}`, `site${i}`);
    }
    expect(useStore.getState().injectHistory.length).toBe(100);
    // 最早插入的（i=0）应该被裁剪掉了
    const ids = useStore.getState().injectHistory.map((e) => e.promptId);
    expect(ids).not.toContain('p0');
    // 最新插入的保留
    expect(ids).toContain('p149');
  });
});

// ── 标签页 ──

describe('标签页管理', () => {
  it('openTab — 打开一个有效站点', () => {
    useStore.getState().openTab('deepseek'); // DEFAULT_SITES 中的
    const tabs = useStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0].siteId).toBe('deepseek');
    expect(useStore.getState().activeTabId).toBe(tabs[0].id);
  });

  it('openTab — 无效站点不创建标签页', () => {
    const before = useStore.getState().tabs.length;
    useStore.getState().openTab('不存在的站点');
    expect(useStore.getState().tabs.length).toBe(before);
  });

  it('closeTab — 关闭当前活跃标签页后回退到上一个', () => {
    useStore.getState().openTab('deepseek');
    useStore.getState().openTab('chatgpt');
    const t1 = useStore.getState().tabs[0];
    const t2 = useStore.getState().tabs[1];
    expect(useStore.getState().activeTabId).toBe(t2.id);

    useStore.getState().closeTab(t2.id);
    expect(useStore.getState().tabs.length).toBe(1);
    expect(useStore.getState().activeTabId).toBe(t1.id);
  });

  it('closeTab — 关闭非活跃标签页不影响活跃状态', () => {
    useStore.getState().openTab('deepseek');
    useStore.getState().openTab('chatgpt');
    const t1 = useStore.getState().tabs[0];
    useStore.getState().closeTab(t1.id);
    expect(useStore.getState().activeTabId).toBe(useStore.getState().tabs[0].id);
  });

  it('closeTab — 关闭唯一的标签页后 activeTabId 为 null', () => {
    useStore.getState().openTab('deepseek');
    const tab = useStore.getState().tabs[0];
    useStore.getState().closeTab(tab.id);
    expect(useStore.getState().tabs.length).toBe(0);
    expect(useStore.getState().activeTabId).toBeNull();
  });

  it('setActiveTab — 切换活跃标签页', () => {
    useStore.getState().openTab('deepseek');
    useStore.getState().openTab('chatgpt');
    const t1 = useStore.getState().tabs[0];
    useStore.getState().setActiveTab(t1.id);
    expect(useStore.getState().activeTabId).toBe(t1.id);
  });
});

// ── UI 状态 ──

describe('UI 状态', () => {
  it('toggleSidebar — 切换侧边栏', () => {
    const before = useStore.getState().sidebarOpen;
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(!before);
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(before);
  });

  it('addCategory — 添加新分类，重复的不添加', () => {
    useStore.getState().addCategory('脚本');
    expect(useStore.getState().userCategories).toContain('脚本');

    const prevLength = useStore.getState().userCategories.length;
    useStore.getState().addCategory('脚本');
    expect(useStore.getState().userCategories.length).toBe(prevLength);
  });

  it('setTheme — 切换主题', () => {
    useStore.getState().setTheme('dark');
    expect(useStore.getState().theme).toBe('dark');
    useStore.getState().setTheme('light');
    expect(useStore.getState().theme).toBe('light');
  });
});

// ── 注入模式 & 策略 ──

describe('注入模式 & 策略', () => {
  it('默认值正确', () => {
    expect(useStore.getState().injectMode).toBe('fill-only');
    expect(useStore.getState().injectStrategy).toBe('replace');
  });

  it('setInjectMode', () => {
    useStore.getState().setInjectMode('fill-and-submit');
    expect(useStore.getState().injectMode).toBe('fill-and-submit');
  });

  it('setInjectStrategy', () => {
    useStore.getState().setInjectStrategy('append');
    expect(useStore.getState().injectStrategy).toBe('append');
  });

  it('lastInjectResult 初始为 null，可读写', () => {
    expect(useStore.getState().lastInjectResult).toBeNull();
    useStore.getState().setLastInjectResult({ success: true });
    expect(useStore.getState().lastInjectResult).toEqual({ success: true });
    useStore.getState().setLastInjectResult(null);
    expect(useStore.getState().lastInjectResult).toBeNull();
  });
});

// ── 浮动面板注入信号 ──

describe('浮动面板注入信号', () => {
  it('pendingInjection 初始为 null', () => {
    expect(useStore.getState().pendingInjection).toBeNull();
  });

  it('triggerInjection / clearInjection', () => {
    useStore.getState().triggerInjection('p1', 'site1');
    expect(useStore.getState().pendingInjection).toEqual({
      promptId: 'p1',
      siteId: 'site1',
    });
    useStore.getState().clearInjection();
    expect(useStore.getState().pendingInjection).toBeNull();
  });
});

// ── promptDrawerOpen ──

describe('提示词抽屉', () => {
  it('初始关闭，可切换', () => {
    expect(useStore.getState().promptDrawerOpen).toBe(false);
    useStore.getState().setPromptDrawerOpen(true);
    expect(useStore.getState().promptDrawerOpen).toBe(true);
  });
});
