import React, { useMemo, useState } from 'react';
import { Blocks, MessageSquare, Plus, Star, Pin, Trash2, Edit3, Copy, Check } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/Toast';
import {
  useStore,
  useAllTags,
  useRecentPrompts,
  useAllCategories,
} from '@/store';
import type { Prompt } from '@/store';
import { filterAndSortPrompts } from '@/features/prompts/domain';
import { PromptFilters } from '@/features/prompts/PromptFilters';
import { PromptEditorDialog } from '@/features/prompts/PromptEditorDialog';
import { PromptCardContent } from '@/features/prompts/PromptCardContent';
import { usePromptCopy } from '@/features/prompts/usePromptCopy';
import { VariableFillDialog } from '@/components/VariableFillDialog';
import { SkillManagementPanel } from './SkillManagementPanel';

// ── 提示词卡片 ──

const PromptCard: React.FC<{
  prompt: Prompt;
  batchMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onEdit?: (prompt: Prompt) => void;
  onCopy: (prompt: Prompt) => void;
}> = ({ prompt, batchMode, selected, onToggleSelect, onEdit, onCopy }) => {
  const { selectedPromptId, selectPrompt, deletePrompt, updatePrompt } = useStore();
  const isSelected = selectedPromptId === prompt.id;

  const handleClick = () => {
    if (batchMode) {
      onToggleSelect?.();
    } else {
      selectPrompt(prompt.id);
    }
  };

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePrompt(prompt.id, { isFavorite: !prompt.isFavorite });
  };

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePrompt(prompt.id, { isPinned: !prompt.isPinned });
  };

  return (
    <div
      className={`group p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${
        (isSelected || selected)
          ? 'bg-primary-light border-primary border-primary shadow-sm'
          : 'bg-card border-border hover:border-primary dark:hover:border-primary'
      }`}
      onClick={handleClick}
    >
      <PromptCardContent
        prompt={prompt}
        leading={batchMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-0.5 h-4 w-4 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : undefined}
        actions={(
          <>
          <button
            className="p-1 rounded hover:bg-accent transition-colors"
            onClick={togglePin}
            title={prompt.isPinned ? '取消置顶' : '置顶'}
          >
            <Pin
              className={`h-3.5 w-3.5 ${
                prompt.isPinned ? 'text-warning fill-amber-500' : 'text-foreground'
              }`}
            />
          </button>
          <button
            className="p-1 rounded hover:bg-accent transition-colors"
            onClick={toggleFavorite}
            title={prompt.isFavorite ? '取消收藏' : '收藏'}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                prompt.isFavorite ? 'text-warning fill-amber-500' : 'text-foreground'
              }`}
            />
          </button>
          <button
            className="rounded p-1 opacity-0 transition-all hover:bg-accent group-hover:opacity-100"
            onClick={(event) => { event.stopPropagation(); onCopy(prompt); }}
            title="复制内容"
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            className="rounded p-1 opacity-0 transition-all hover:bg-accent group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(prompt);
            }}
            title="编辑"
          >
            <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            className="rounded p-1 opacity-0 transition-all hover:bg-destructive/10 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('确定删除？')) deletePrompt(prompt.id);
            }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </button>
          </>
        )}
      />
    </div>
  );
};

// ── 主侧边栏 ──

export const PromptSidebar: React.FC = () => {
  const {
    prompts: allPrompts,
    skills,
    selectedPromptId,
    selectPrompt,
    batchDeletePrompts,
  } = useStore();
  const recentPrompts = useRecentPrompts(5);
  const allTags = useAllTags();
  const categories = useAllCategories();
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const prompts = useMemo(() => filterAndSortPrompts(allPrompts, {
    search, category: filterCategory, tag: filterTag,
  }), [allPrompts, search, filterCategory, filterTag]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | undefined>();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [managementTab, setManagementTab] = useState<'prompts' | 'skills'>('prompts');
  const { toast } = useToast();
  const copy = usePromptCopy({
    onCopied: () => toast('已复制填写后的提示词', 'success'),
    onBlocked: () => toast('该提示词已停用，无法复制', 'error'),
  });


  return (
    <div className="h-full flex-1 flex flex-col bg-card relative">
      <div className="flex h-11 shrink-0 items-end gap-1 border-b bg-background px-4">
        <button className={`flex h-10 items-center gap-2 border-b-2 px-3 text-xs font-medium transition-colors ${managementTab === 'prompts' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setManagementTab('prompts')}>
          <MessageSquare className="h-4 w-4" />提示词
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{allPrompts.length}</span>
        </button>
        <button className={`flex h-10 items-center gap-2 border-b-2 px-3 text-xs font-medium transition-colors ${managementTab === 'skills' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setManagementTab('skills')}>
          <Blocks className="h-4 w-4" />技能
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{skills.length}</span>
        </button>
      </div>
      {managementTab === 'skills' ? <SkillManagementPanel /> : <>
      <PromptFilters
        search={search}
        category={filterCategory}
        tag={filterTag}
        categories={categories}
        tags={allTags}
        onSearchChange={setSearch}
        onCategoryChange={setFilterCategory}
        onTagChange={setFilterTag}
      />
      <Separator />

      {/* 最近使用 */}
      {recentPrompts.length > 0 && (
        <>
          <div className="px-3 py-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">
              最近使用
            </span>
          </div>
          <div className="px-3 space-y-0.5">
            {recentPrompts.map((p) => (
              <div
                key={`recent-${p.id}`}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer truncate py-0.5"
                onClick={() => selectPrompt(p.id)}
              >
                {p.title}
              </div>
            ))}
          </div>
          <Separator />
        </>
      )}

      {/* 列表头 + 操作按钮 */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          提示词 ({prompts.length})
        </span>
        <div className="flex gap-1">
          {batchMode && selectedIds.size > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive"
              onClick={() => {
                if (confirm(`确定删除 ${selectedIds.size} 条提示词？`)) {
                  batchDeletePrompts([...selectedIds]);
                  setSelectedIds(new Set());
                  setBatchMode(false);
                }
              }}
              title="批量删除"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 ${batchMode ? 'text-primary' : ''}`}
            onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }}
            title="批量模式"
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { setEditingPrompt(undefined); setEditorOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {prompts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              没有匹配的提示词
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {prompts.map((p) => (
                <PromptCard
                  key={p.id}
                  prompt={p}
                  batchMode={batchMode}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                      return next;
                    })
                  }
                  onEdit={(prompt) => {
                    setEditingPrompt(prompt);
                    setEditorOpen(true);
                  }}
                  onCopy={(prompt) => void copy.requestCopy(prompt)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：选中提示词的快捷信息 */}
      {selectedPromptId && (
        <div className="border-t p-2 text-[10px] text-muted-foreground bg-background">
          <span className="text-muted-foreground text-foreground font-medium">
            {allPrompts.find((p) => p.id === selectedPromptId)?.title}
          </span>
          <span className="ml-2">
            {allPrompts.find((p) => p.id === selectedPromptId)?.variables
              .length ?? 0}{' '}
            个变量
          </span>
        </div>
      )}
      </>}

      {/* 编辑器浮层 */}
      {managementTab === 'prompts' && editorOpen && (
        <PromptEditorDialog
          prompt={editingPrompt}
          onClose={() => setEditorOpen(false)}
        />
      )}
      {managementTab === 'prompts' && copy.promptToFill && (
        <VariableFillDialog
          content={copy.promptToFill.content}
          variables={copy.promptToFill.variables}
          onConfirm={(_content, values) => void copy.confirmCopy(values)}
          onCancel={copy.cancelCopy}
        />
      )}
    </div>
  );
};
