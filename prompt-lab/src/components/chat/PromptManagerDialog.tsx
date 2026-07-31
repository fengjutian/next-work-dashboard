import React from 'react';
import { MessageSquare, Pin, X } from '@/components/icons';
import { useStore } from '@/store';
import type { Prompt } from '@/store/types';

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

  if (!open) return null;

  const enabledCount = prompts.filter(isPromptEnabled).length;

  const togglePrompt = (prompt: Prompt) => {
    updatePrompt(prompt.id, { enabled: !isPromptEnabled(prompt) });
  };

  // 按分类分组
  const grouped = prompts.reduce<Record<string, Prompt[]>>((acc, p) => {
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
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="h-5 w-5 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              提示词管理
            </h2>
            <div className="flex gap-1.5">
              <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                {enabledCount} / {prompts.length} 已启用
              </span>
              {boundCount > 0 && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                  📌 {boundCount} 已绑定
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>

        {/* 提示词列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {prompts.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-10 w-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-400">暂无提示词</p>
            </div>
          ) : (
            sortedCategories.map((category) => (
              <div key={category}>
                <h3 className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span>{category}</span>
                  <span className="text-[10px] text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
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
                            ? 'bg-zinc-50 dark:bg-zinc-800/20 opacity-55'
                            : isBound
                              ? 'bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-700/30'
                              : 'bg-white dark:bg-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isBound && <Pin className="h-3 w-3 text-amber-500 shrink-0" />}
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                              {prompt.title}
                            </span>
                            {prompt.tags.length > 0 && (
                              <span className="text-[10px] text-zinc-400 truncate max-w-[80px]">
                                #{prompt.tags.join(' #')}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                              !enabled
                                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                                : isBound
                                  ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                  : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                            }`}>
                              {!enabled ? '已禁用' : isBound ? '已绑定' : '已启用'}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">
                            {prompt.content.slice(0, 100)}{prompt.content.length > 100 ? '...' : ''}
                          </p>
                        </div>

                        {/* 操作按钮组 */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* 绑定切换 */}
                          {onToggleBound && enabled && (
                            <button
                              onClick={() => onToggleBound(prompt.id)}
                              className={`p-1.5 rounded-lg transition-colors ${
                                isBound
                                  ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                  : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                              title={isBound ? '取消绑定对话' : '绑定到当前对话（自动注入到 system prompt）'}
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* 启用/禁用 */}
                          <button
                            onClick={() => togglePrompt(prompt)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
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
        <div className="px-5 py-3 border-t text-[10px] text-zinc-400 shrink-0 space-y-1">
          <p>🔄 <strong>启用/禁用</strong> — 禁用后提示词不会自动注入到输入框</p>
          <p>📌 <strong>绑定到对话</strong> — 每次对话自动合并到 system prompt（永久生效）</p>
        </div>
      </div>
    </div>
  );
};
