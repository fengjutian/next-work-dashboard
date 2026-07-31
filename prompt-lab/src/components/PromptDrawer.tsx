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
      className="group p-3 rounded-lg border border-border cursor-pointer hover:border-primary hover:shadow-sm transition-all bg-card"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h5 className="text-sm font-medium text-foreground truncate">
            {prompt.title}
          </h5>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 line-clamp-2">
            {preview}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {prompt.isPinned && <Pin className="h-3 w-3 text-warning fill-amber-500" />}
          {prompt.isFavorite && <Star className="h-3 w-3 text-warning fill-amber-500" />}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {prompt.category}
        </span>
        {prompt.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {t}
          </span>
        ))}
        <span className="text-[9px] text-muted-foreground ml-auto">×{prompt.usageCount}</span>
        <button
          className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
          title="复制"
        >
          <Copy className="h-3 w-3 text-muted-foreground" />
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
      <div className="fixed right-0 top-0 bottom-0 w-[380px] z-50 bg-card border-l shadow-2xl flex flex-col animate-slide-in-right">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-foreground">
            提示词
          </h3>
          <button
            className="p-1 rounded hover:bg-accent transition-colors"
            onClick={() => setPromptDrawerOpen(false)}
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* 搜索 */}
        <div className="p-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full h-8 pl-8 pr-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 ring-ring"
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
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
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
                    ? 'bg-primary text-white'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
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
                      ? 'border-primary bg-primary-light text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
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
              <p className="text-xs text-muted-foreground text-center py-12">
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
