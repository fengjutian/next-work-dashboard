import React, { useState } from 'react';
import { Search, Plus, Star, Pin, Trash2, Edit3, X, Copy, Check } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/Toast';
import {
  useStore,
  useFilteredPrompts,
  useAllTags,
  useRecentPrompts,
  useAllCategories,
  CATEGORIES,
} from '@/store';
import type { Prompt } from '@/store';

// ── 提示词卡片 ──

const PromptCard: React.FC<{
  prompt: Prompt;
  batchMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onEdit?: (prompt: Prompt) => void;
}> = ({ prompt, batchMode, selected, onToggleSelect, onEdit }) => {
  const { selectedPromptId, selectPrompt, deletePrompt, updatePrompt } = useStore();
  const isSelected = selectedPromptId === prompt.id;
  const { toast } = useToast();

  const handleClick = () => {
    if (batchMode) {
      onToggleSelect?.();
    } else {
      selectPrompt(prompt.id);
    }
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

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePrompt(prompt.id, { isFavorite: !prompt.isFavorite });
  };

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePrompt(prompt.id, { isPinned: !prompt.isPinned });
  };

  // 内容预览：取前 120 个字符，去掉变量标记
  const preview = prompt.content
    .replace(/\{\{.*?\}\}/g, '___')
    .slice(0, 120) + (prompt.content.length > 120 ? '…' : '');

  return (
    <div
      className={`group p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${
        (isSelected || selected)
          ? 'bg-blue-50 dark:bg-blue-950 border-blue-400 dark:border-blue-600 shadow-sm'
          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700'
      }`}
      onClick={handleClick}
    >
      {/* 顶部：置顶 + 收藏 + 标题 */}
      <div className="flex items-start gap-2 mb-2">
        {batchMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="shrink-0 h-4 w-4 mt-0.5"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">
            {prompt.title}
          </h4>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-medium">
              {prompt.category}
            </span>
            {prompt.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
              >
                {t}
              </span>
            ))}
            {prompt.tags.length > 3 && (
              <span className="text-[10px] text-zinc-400">+{prompt.tags.length - 3}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={togglePin}
            title={prompt.isPinned ? '取消置顶' : '置顶'}
          >
            <Pin
              className={`h-3.5 w-3.5 ${
                prompt.isPinned ? 'text-amber-500 fill-amber-500' : 'text-zinc-300'
              }`}
            />
          </button>
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={toggleFavorite}
            title={prompt.isFavorite ? '取消收藏' : '收藏'}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                prompt.isFavorite ? 'text-amber-500 fill-amber-500' : 'text-zinc-300'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 内容预览 */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3 mb-3">
        {preview}
      </p>

      {/* 底部：使用次数 + 操作按钮 */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">
          使用 {prompt.usageCount} 次
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={handleCopy}
            title="复制内容"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400" />
          </button>
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(prompt);
            }}
            title="编辑"
          >
            <Edit3 className="h-3.5 w-3.5 text-zinc-400" />
          </button>
          <button
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('确定删除？')) deletePrompt(prompt.id);
            }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 提示词编辑对话框 ──

const PromptEditor: React.FC<{
  prompt?: Prompt;
  onClose: () => void;
}> = ({ prompt, onClose }) => {
  const { addPrompt, updatePrompt } = useStore();
  const categories = useAllCategories();
  const [title, setTitle] = useState(prompt?.title ?? '');
  const [content, setContent] = useState(prompt?.content ?? '');
  const [category, setCategory] = useState(prompt?.category ?? '通用');
  const [tagsStr, setTagsStr] = useState(prompt?.tags.join(', ') ?? '');

  const handleSave = () => {
    const now = Date.now();
    const tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (prompt) {
      updatePrompt(prompt.id, { title, content, category, tags, updatedAt: now });
    } else {
      addPrompt({
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        content,
        category,
        tags,
        variables: [],
        isFavorite: false,
        isPinned: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50 bg-white dark:bg-zinc-950 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">
          {prompt ? '编辑提示词' : '新建提示词'}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 p-3 space-y-3 overflow-y-auto">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">标题</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="提示词标题"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">
            正文（用 {'{{变量名}}'} 表示占位符）
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入提示词内容..."
            className="w-full h-32 text-sm p-2 rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">分类</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-8 text-sm border rounded-md px-2"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">
            标签（逗号分隔）
          </label>
          <Input
            value={tagsStr}
            onChange={(e) => setTagsStr(e.target.value)}
            placeholder="代码, 审查"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="p-3 border-t flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
          保存
        </Button>
      </div>
    </div>
  );
};

// ── 主侧边栏 ──

export const PromptSidebar: React.FC = () => {
  const {
    searchQuery,
    setSearch,
    filterCategory,
    setFilterCategory,
    filterTag,
    setFilterTag,
    selectedPromptId,
    selectPrompt,
    batchDeletePrompts,
    addCategory,
  } = useStore();
  const prompts = useFilteredPrompts();
  const recentPrompts = useRecentPrompts(5);
  const allTags = useAllTags();
  const categories = useAllCategories();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | undefined>();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());


  return (
    <div className="h-full flex-1 flex flex-col bg-white dark:bg-zinc-950 relative">
      {/* 搜索框 */}
      <div className="p-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            className="w-full h-8 pl-7 pr-2 text-sm rounded-md border bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="搜索提示词..."
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      {/* 分类筛选 */}
      <div className="px-3 py-2">
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
              onClick={() =>
                setFilterCategory(filterCategory === cat ? null : cat)
              }
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 标签筛选 */}
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

      <Separator />

      {/* 最近使用 */}
      {recentPrompts.length > 0 && (
        <>
          <div className="px-3 py-2">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase">
              最近使用
            </span>
          </div>
          <div className="px-3 space-y-0.5">
            {recentPrompts.map((p) => (
              <div
                key={`recent-${p.id}`}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer truncate py-0.5"
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
        <span className="text-xs font-semibold text-zinc-400 uppercase">
          提示词 ({prompts.length})
        </span>
        <div className="flex gap-1">
          {batchMode && selectedIds.size > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-500"
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
            className={`h-6 w-6 ${batchMode ? 'text-blue-500' : ''}`}
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
            <p className="text-sm text-zinc-400 text-center py-16">
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
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：选中提示词的快捷信息 */}
      {selectedPromptId && (
        <div className="border-t p-2 text-[10px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900">
          <span className="text-zinc-600 dark:text-zinc-300 font-medium">
            {prompts.find((p) => p.id === selectedPromptId)?.title}
          </span>
          <span className="ml-2">
            {prompts.find((p) => p.id === selectedPromptId)?.variables
              .length ?? 0}{' '}
            个变量
          </span>
        </div>
      )}

      {/* 编辑器浮层 */}
      {editorOpen && (
        <PromptEditor
          prompt={editingPrompt}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
};
