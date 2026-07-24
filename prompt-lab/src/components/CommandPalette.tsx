import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from '@/components/icons';
import { useStore } from '@/store';

// ── 浮动搜索面板 ──

export const CommandPalette: React.FC = () => {
  const {
    prompts,
    sites,
    tabs,
    activeTabId,
    openTab,
    selectPrompt,
  } = useStore();

  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 过滤匹配的提示词
  const filtered = query
    ? prompts.filter(
        (p) =>
          p.title.toLowerCase().includes(query.toLowerCase()) ||
          p.content.toLowerCase().includes(query.toLowerCase()) ||
          p.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()))
      )
    : prompts.slice(0, 8);

  // 监听快捷键
  useEffect(() => {
    const cleanup = window.electronAPI?.onToggleSearchPanel(() => {
      setVisible((v) => !v);
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    });

    // 也支持本地 Ctrl+K 唤起
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setVisible((v) => !v);
        setQuery('');
        setSelectedIndex(0);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && visible) {
        setVisible(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cleanup?.();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible]);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const prompt = filtered[selectedIndex];
      if (prompt) handleSelect(prompt);
    }
  };

  // 选择并注入 — 通过 store 信号通知 WebViewPanel 执行注入
  const handleSelect = useCallback(
    (prompt: (typeof prompts)[0]) => {
      setVisible(false);
      selectPrompt(prompt.id);

      // 确保有打开的标签
      const currentTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
      if (!currentTab) {
        const firstSite = sites.find((s) => s.enabled);
        if (firstSite) openTab(firstSite.id);
        return;
      }

      const site = sites.find((s) => s.id === currentTab.siteId);
      if (!site) return;

      // 通过 store 信号触发 WebViewPanel 注入
      useStore.getState().triggerInjection(prompt.id, site.id);
    },
    [tabs, activeTabId, sites, openTab, selectPrompt]
  );

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh] bg-black/40"
      onClick={() => setVisible(false)}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl w-[520px] max-h-[60vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
            placeholder="搜索提示词并注入..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <kbd className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-8">
              没有匹配的提示词
            </p>
          ) : (
            filtered.map((prompt, i) => (
              <div
                key={prompt.id}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm ${
                  i === selectedIndex
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
                onClick={() => handleSelect(prompt)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="flex-1 truncate">{prompt.title}</span>
                <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded shrink-0">
                  {prompt.category}
                </span>
                {prompt.isFavorite && <span className="text-amber-500 text-xs">★</span>}
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t flex gap-3 text-[10px] text-zinc-400">
          <span>↑↓ 导航</span>
          <span>↵ 注入</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
};
