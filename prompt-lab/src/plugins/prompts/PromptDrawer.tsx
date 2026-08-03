import React, { useMemo, useState } from 'react';
import { X, Pin, Star, Copy } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/Toast';
import { useStore, useAllTags, useAllCategories } from '@/store';
import type { Prompt } from '@/store';
import { filterAndSortPrompts } from '@/features/prompts/domain';
import { PromptFilters } from '@/features/prompts/PromptFilters';
import { PromptCardContent } from '@/features/prompts/PromptCardContent';
import { usePromptCopy } from '@/features/prompts/usePromptCopy';
import { VariableFillDialog } from '@/components/VariableFillDialog';

// ── 抽屉中的提示词卡片 ──

const DrawerCard: React.FC<{
  prompt: Prompt;
  onSelect: (prompt: Prompt) => void;
  onCopy: (prompt: Prompt) => void;
}> = ({ prompt, onSelect, onCopy }) => {
  const { triggerInjection, tabs, activeTabId } = useStore();
  const { toast } = useToast();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleClick = () => {
    if (activeTab) {
      triggerInjection(prompt.id, activeTab.siteId);
      toast(`已选择「${prompt.title}」`, 'success');
    }
    onSelect(prompt);
  };

  return (
    <div
      className="group p-3 rounded-lg border border-border cursor-pointer hover:border-primary hover:shadow-sm transition-all bg-card"
      onClick={handleClick}
    >
      <PromptCardContent
        compact
        prompt={prompt}
        actions={(
          <>
          {prompt.isPinned && <Pin className="h-3 w-3 text-warning fill-amber-500" />}
          {prompt.isFavorite && <Star className="h-3 w-3 text-warning fill-amber-500" />}
            <button
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
              onClick={(event) => { event.stopPropagation(); onCopy(prompt); }}
              title="复制"
            >
              <Copy className="h-3 w-3 text-muted-foreground" />
            </button>
          </>
        )}
      />
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
  const { toast } = useToast();
  const copy = usePromptCopy({
    onCopied: () => toast('已复制填写后的提示词', 'success'),
    onBlocked: () => toast('该提示词已停用，无法复制', 'error'),
  });
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
                  onCopy={(prompt) => void copy.requestCopy(prompt)}
                />
              ))
            )}
          </div>
        </ScrollArea>
        {copy.promptToFill && (
          <VariableFillDialog
            content={copy.promptToFill.content}
            variables={copy.promptToFill.variables}
            onConfirm={(_content, values) => void copy.confirmCopy(values)}
            onCancel={copy.cancelCopy}
          />
        )}
      </div>
    </>
  );
};
