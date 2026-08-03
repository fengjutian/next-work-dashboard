import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from '@/components/icons';
import { useStore } from '@/store';
import { pluginRegistry, usePluginRegistryVersion } from '@/plugins';
import { filterAndSortPrompts } from '@/features/prompts/domain';

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

  // 命令模式：输入以 '>' 开头
  const isCommandMode = query.startsWith('>');
  const cmdQuery = isCommandMode ? query.slice(1).trim() : '';

  // 所有插件命令 — 通过订阅保证实时性
  const registryVersion = usePluginRegistryVersion();
  const allCommands = React.useMemo(
    () => pluginRegistry.getCommands(),
    [registryVersion],
  );

  // 过滤命令
  const filteredCommands = React.useMemo(() => {
    if (!cmdQuery) return allCommands;
    const q = cmdQuery.toLowerCase();
    return allCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q) ||
        c.pluginId.toLowerCase().includes(q),
    );
  }, [allCommands, cmdQuery]);

  // 过滤提示词（非命令模式）
  const filteredPrompts = !isCommandMode
    ? filterAndSortPrompts(prompts, { search: query, enabledOnly: true }).slice(0, query ? undefined : 8)
    : [];

  // 总结果列表
  const results = isCommandMode ? filteredCommands : filteredPrompts;

  // 重置选中索引
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [isCommandMode, query]);

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
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selectedIndex];
      if (isCommandMode) {
        handleCommandSelect(item as typeof allCommands[0]);
      } else {
        handlePromptSelect(item as typeof prompts[0]);
      }
    }
  };

  // 选择并注入提示词
  const handlePromptSelect = useCallback(
    (prompt: (typeof prompts)[0]) => {
      if (!prompt) return;
      setVisible(false);
      selectPrompt(prompt.id);

      const currentTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
      if (!currentTab) {
        const firstSite = sites.find((s) => s.enabled);
        if (firstSite) openTab(firstSite.id);
        return;
      }

      const site = sites.find((s) => s.id === currentTab.siteId);
      if (!site) return;

      useStore.getState().triggerInjection(prompt.id, site.id);
    },
    [tabs, activeTabId, sites, openTab, selectPrompt],
  );

  // 选择并触发命令
  const handleCommandSelect = useCallback(
    (cmd: { id: string; title: string; pluginId: string }) => {
      if (!cmd) return;
      setVisible(false);
      // 先激活命令所属插件面板
      const plugin = pluginRegistry.get(cmd.pluginId);
      if (plugin?.enabled) {
        useStore.getState().setActiveActivity(cmd.pluginId);
      }
      // 通过 registry 执行命令
      pluginRegistry.executeCommand(cmd.id);
    },
    [],
  );

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh] bg-black/40"
      onClick={() => setVisible(false)}
    >
      <div
        className="bg-card rounded-lg shadow-2xl w-[520px] max-h-[60vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            placeholder={isCommandMode ? '输入命令关键词...' : '搜索提示词或输入 > 执行命令...'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-y-auto py-1">
          {/* 非命令模式 + 空查询 + 有命令时：提示输入 > */}
          {!isCommandMode && query === '' && allCommands.length > 0 && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">
              输入 <code className="text-primary bg-primary-light px-1 py-0.5 rounded">{'>'}</code> 查看全部插件命令
            </div>
          )}

          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {isCommandMode ? '没有匹配的命令' : '没有匹配的提示词'}
            </p>
          ) : isCommandMode ? (
            // 命令列表
            results.map((cmd: any, i) => (
              <div
                key={cmd.id}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm ${
                  i === selectedIndex
                    ? 'bg-primary-light text-primary'
                    : 'text-foreground hover:bg-background dark:hover:bg-muted'
                }`}
                onClick={() => handleCommandSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-warning shrink-0">⚡</span>
                <span className="flex-1 truncate">{cmd.title}</span>
                {cmd.category && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{cmd.category}</span>
                )}
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {cmd.pluginId}
                </span>
              </div>
            ))
          ) : (
            // 提示词列表
            results.map((prompt: any, i) => (
              <div
                key={prompt.id}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm ${
                  i === selectedIndex
                    ? 'bg-primary-light text-primary'
                    : 'text-foreground hover:bg-background dark:hover:bg-muted'
                }`}
                onClick={() => handlePromptSelect(prompt)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="flex-1 truncate">{prompt.title}</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {prompt.category}
                </span>
                {prompt.isFavorite && <span className="text-warning text-xs">★</span>}
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t flex gap-3 text-[10px] text-muted-foreground">
          <span>↑↓ 导航</span>
          <span>↵ 选择</span>
          <span>Esc 关闭</span>
          {!isCommandMode && <span>{'>'} 命令</span>}
        </div>
      </div>
    </div>
  );
};
