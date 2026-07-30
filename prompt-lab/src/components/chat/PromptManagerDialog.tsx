import React from 'react';
import { MessageSquare, X } from '@/components/icons';
import { useStore } from '@/store';
import type { Prompt } from '@/store/types';

/** 检查提示词是否启用（默认 true） */
export function isPromptEnabled(prompt: Prompt): boolean {
  return prompt.enabled !== false;
}

/**
 * 提示词管理器弹层
 *
 * 展示所有提示词，允许用户逐个启用/禁用。
 * 默认全部启用，禁用的提示词不会自动注入到输入框。
 */
export const PromptManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
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

  // 分类排序（预设在前，自定义在后）
  const categoryOrder = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="h-5 w-5 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              提示词管理
            </h2>
            <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
              {enabledCount} / {prompts.length} 已启用
            </span>
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
                    return (
                      <div
                        key={prompt.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                          enabled
                            ? 'bg-white dark:bg-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                            : 'bg-zinc-50 dark:bg-zinc-800/20 opacity-60'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                              {prompt.title}
                            </span>
                            {prompt.tags.length > 0 && (
                              <span className="text-[10px] text-zinc-400 truncate max-w-[100px]">
                                #{prompt.tags.join(' #')}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                              enabled
                                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                            }`}>
                              {enabled ? '已启用' : '已禁用'}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">
                            {prompt.content.slice(0, 100)}{prompt.content.length > 100 ? '...' : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => togglePrompt(prompt)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                          }`}
                          role="switch"
                          aria-checked={enabled}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${
                              enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-3 border-t text-[10px] text-zinc-400 shrink-0">
          禁用后，提示词不会自动注入到 AI 对话输入框。提示词本身不会被删除。
        </div>
      </div>
    </div>
  );
};
