import React, { useState } from 'react';
import { X, Search, Pin, Star, Copy, Edit3 } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/Toast';
import { useStore, useFilteredPrompts, useAllTags, useAllCategories } from '@/store';
import type { Prompt } from '@/store';

// ── 抽屉中的提示词卡片 ──

const DrawerCard: React.FC<{
  prompt: Prompt;
  onSelect: (prompt: Prompt) => void;
}> = ({ prompt, onSelect }) => {
  const { updatePrompt, triggerInjection, tabs, activeTabId } = useStore();
  const { toast } = useToast();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleClick = () => {
    if (activeTab) {
      triggerInjection(prompt.id, activeTab.siteId);
      toast(`已选择「${prompt.title}」`, 'success');
    }
    onSelect(prompt);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.electronAPI?.copyText) {
      window.electronAPI.copyText(prompt.content);
    } else {
      navigator.clipboard.writeText(prompt.content);
    }
    toast('已复制到剪贴板', 'success');
  };

  const preview = prompt.content
    .replace(/\{\{.*?\}\}/g, '___')
    .slice(0, 80) + (prompt.content.length > 80 ? '…' : '');

  return (
    <div
      className="group p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all bg-white dark:bg-zinc-900"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h5 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
            {prompt.title}
          </h5>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-1 line-clamp-2">
            {preview}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {prompt.isPinned && <Pin className="h-3 w-3 text-amber-500 fill-amber-500" />}
          {prompt.isFavorite && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
          {prompt.category}
        </span>
        {prompt.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
            {t}
          </span>
        ))}
        <span className="text-[9px] text-zinc-400 ml-auto">×{prompt.usageCount}</span>
        <button
          className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
          title="复制"
        >
          <Copy className="h-3 w-3 text-zinc-400" />
        </button>
      </div>
    </div>
  );
};

// ── 提示词抽屉 ──

export const PromptDrawer: React.FC = () => {
  const { promptDrawerOpen, setPromptDrawerOpen, searchQuery, setSearch, filterCategory, setFilterCategory, filterTag, setFilterTag } = useStore();
  const prompts = useFilteredPrompts();
  const allTags = useAllTags();
  const categories = useAllCategories();

  if (!promptDrawerOpen) return null;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => setPromptDrawerOpen(false)}
      />

      {/* 抽屉面板 */}
      <div className="fixed right-0 top-0 bottom-0 w-[380px] z-50 bg-white dark:bg-zinc-950 border-l shadow-2xl flex flex-col animate-slide-in-right">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            提示词
          </h3>
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => setPromptDrawerOpen(false)}
          >
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        {/* 搜索 */}
        <div className="p-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              className="w-full h-8 pl-8 pr-2 text-sm rounded-md border bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="搜索提示词..."
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* 分类筛选 */}
        <div className="px-3 pb-2">
          <div className="flex flex-wrap gap-1">
            <button
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                !filterCategory
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200'
              }`}
              onClick={() => setFilterCategory(null)}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  filterCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200'
                }`}
                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1.5">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                    filterTag === tag
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950 text-blue-600'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-400'
                  }`}
                  onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 列表 */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {prompts.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-12">
                没有匹配的提示词
              </p>
            ) : (
              prompts.map((p) => (
                <DrawerCard
                  key={p.id}
                  prompt={p}
                  onSelect={() => setPromptDrawerOpen(false)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
};
