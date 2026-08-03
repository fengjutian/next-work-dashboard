import React, { useMemo, useState } from 'react';
import { MessageSquare, Pin, X } from '@/components/icons';
import { useStore } from '@/store';
import type { Prompt } from '@/store/types';
import { useAllCategories, useAllTags } from '@/store';
import { filterAndSortPrompts } from '@/features/prompts/domain';
import { PromptFilters } from '@/features/prompts/PromptFilters';

/** 检查提示词是否启用（默认 true） */
export function isPromptEnabled(prompt: Prompt): boolean {
  return prompt.enabled !== false;
}

/**
 * 提示词管理器弹层
 *
 * 展示所有提示词，允许用户：
 *  - 启用/禁用（禁用的提示词不会自动注入到输入框）
 *  - 绑定到当前对话（绑定的提示词每次自动合并到 system prompt）
 */
export const PromptManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  boundPromptIds?: string[];
  onToggleBound?: (promptId: string) => void;
}> = ({ open, onClose, boundPromptIds = [], onToggleBound }) => {
  const prompts = useStore((s) => s.prompts);
  const updatePrompt = useStore((s) => s.updatePrompt);
  const categories = useAllCategories();
  const tags = useAllTags();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const visiblePrompts = useMemo(() => filterAndSortPrompts(prompts, {
    search, category, tag,
  }), [prompts, search, category, tag]);

  if (!open) return null;

  const enabledCount = prompts.filter(isPromptEnabled).length;

  const togglePrompt = (prompt: Prompt) => {
    updatePrompt(prompt.id, { enabled: !isPromptEnabled(prompt) });
  };

  // 按分类分组
  const grouped = visiblePrompts.reduce<Record<string, Prompt[]>>((acc, p) => {
    const cat = p.category || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  // 分类排序
  const categoryOrder = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const boundCount = boundPromptIds.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              提示词管理
            </h2>
            <div className="flex gap-1.5">
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {enabledCount} / {prompts.length} 已启用
              </span>
              {boundCount > 0 && (
                <span className="text-[10px] text-warning text-warning bg-warning/10 bg-warning/10 px-2 py-0.5 rounded-full">
                  📌 {boundCount} 已绑定
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <PromptFilters
          compact
          search={search}
          category={category}
          tag={tag}
          categories={categories}
          tags={tags}
          onSearchChange={setSearch}
          onCategoryChange={setCategory}
          onTagChange={setTag}
        />

        {/* 提示词列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {visiblePrompts.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-10 w-10 text-foreground text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">没有符合条件的提示词</p>
            </div>
          ) : (
            sortedCategories.map((category) => (
              <div key={category}>
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span>{category}</span>
                  <span className="text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded">
                    {grouped[category].length}
                  </span>
                </h3>
                <div className="space-y-1">
                  {grouped[category].map((prompt) => {
                    const enabled = isPromptEnabled(prompt);
                    const isBound = boundPromptIds.includes(prompt.id);

                    return (
                      <div
                        key={prompt.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                          !enabled
                            ? 'bg-background bg-muted/20 opacity-55'
                            : isBound
                              ? 'bg-warning/10 bg-warning/10 border border-warning/50 border-warning/30'
                              : 'bg-card/50 hover:bg-background dark:hover:bg-muted'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isBound && <Pin className="h-3 w-3 text-warning shrink-0" />}
                            <span className="text-xs font-medium text-foreground truncate">
                              {prompt.title}
                            </span>
                            {prompt.tags.length > 0 && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                                #{prompt.tags.join(' #')}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                              !enabled
                                ? 'bg-muted text-muted-foreground'
                                : isBound
                                  ? 'bg-warning/10 bg-warning/10 text-warning text-warning'
                                  : 'bg-success/10 bg-success/10 text-success text-success'
                            }`}>
                              {!enabled ? '已禁用' : isBound ? '已绑定' : '已启用'}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                            {prompt.content.slice(0, 100)}{prompt.content.length > 100 ? '...' : ''}
                          </p>
                        </div>

                        {/* 操作按钮组 */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* 绑定切换 */}
                          {onToggleBound && enabled && (
                            <button
                              onClick={() => onToggleBound(prompt.id)}
                              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition-colors ${
                                isBound
                                  ? 'bg-warning/10 text-warning hover:bg-warning/20'
                                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                              title={isBound ? '取消绑定对话' : '绑定到当前对话（自动注入到 system prompt）'}
                            >
                              <Pin className="h-3 w-3" />
                              {isBound ? '已加入系统提示词' : '加入系统提示词'}
                            </button>
                          )}

                          {/* 启用/禁用 */}
                          <span className="text-[10px] text-muted-foreground">{enabled ? '可使用' : '已停用'}</span>
                          <button
                            onClick={() => togglePrompt(prompt)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              enabled ? 'bg-success' : 'bg-input'
                            }`}
                            role="switch"
                            aria-checked={enabled}
                            title={enabled ? '禁用' : '启用'}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${
                                enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-3 border-t text-[10px] text-muted-foreground shrink-0 space-y-1">
          <p>🔄 <strong>启用/禁用</strong> — 禁用后提示词不会自动注入到输入框</p>
          <p>📌 <strong>绑定到对话</strong> — 每次对话自动合并到 system prompt（永久生效）</p>
        </div>
      </div>
    </div>
  );
};
