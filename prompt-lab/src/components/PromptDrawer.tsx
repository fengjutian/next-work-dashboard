import React, { useMemo, useState } from 'react';
import { X, Pin, Star, Copy } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/Toast';
import { useStore, useAllTags, useAllCategories } from '@/store';
import type { Prompt } from '@/store';
import { filterAndSortPrompts, getPromptPreview } from '@/features/prompts/domain';
import { PromptFilters } from '@/features/prompts/PromptFilters';

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

  const preview = getPromptPreview(prompt.content, 80);

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
  const { promptDrawerOpen, setPromptDrawerOpen, prompts: allPrompts } = useStore();
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const allTags = useAllTags();
  const categories = useAllCategories();
  const prompts = useMemo(() => filterAndSortPrompts(allPrompts, {
    search, category: filterCategory, tag: filterTag, enabledOnly: true,
  }), [allPrompts, search, filterCategory, filterTag]);

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

        <PromptFilters
          compact
          search={search}
          category={filterCategory}
          tag={filterTag}
          categories={categories}
          tags={allTags}
          onSearchChange={setSearch}
          onCategoryChange={setFilterCategory}
          onTagChange={setFilterTag}
        />

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
