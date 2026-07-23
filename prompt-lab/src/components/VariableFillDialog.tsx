import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PromptVariable } from '@/store';

// 从提示词内容中提取 {{变量名}} 
export function extractVariables(content: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

// 替换变量
export function fillVariables(
  content: string,
  values: Record<string, string>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? `{{${name}}}`);
}

// ── 变量填充对话框 ──

interface Props {
  content: string;
  variables?: PromptVariable[];
  onConfirm: (filledContent: string) => void;
  onCancel: () => void;
}

export const VariableFillDialog: React.FC<Props> = ({
  content,
  variables = [],
  onConfirm,
  onCancel,
}) => {
  const varNames = extractVariables(content);
  const [values, setValues] = useState<Record<string, string>>({});

  // 从提示词定义的 variables 中读取默认值
  useEffect(() => {
    const init: Record<string, string> = {};
    variables.forEach((v) => {
      if (v.defaultValue) init[v.name] = v.defaultValue;
    });
    setValues((prev) => ({ ...init, ...prev }));
  }, [variables]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        onConfirm(fillVariables(content, values));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, values, onConfirm, onCancel]);

  const handleSubmit = () => {
    onConfirm(fillVariables(content, values));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-[640px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">
            填充变量 ({varNames.length})
          </h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 预览 */}
        <div className="px-4 py-2 border-b bg-zinc-50 dark:bg-zinc-950">
          <p className="text-[10px] text-zinc-400 uppercase mb-1">预览</p>
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap max-h-20 overflow-y-auto">
            {fillVariables(content, values)}
          </pre>
        </div>

        {/* 变量输入 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {varNames.map((name) => {
            const def = variables.find((v) => v.name === name);
            return (
            <div key={name}>
              <label className="text-xs text-zinc-500 block mb-1">
                {`{{${name}}}`}
                {def?.description && (
                  <span className="text-zinc-300 ml-1">— {def.description}</span>
                )}
              </label>
              <textarea
                value={values[name] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [name]: e.target.value }))
                }
                placeholder={def?.defaultValue || `输入 ${name} 的值...`}
                className="w-full h-20 text-sm p-2 rounded-md border resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-950"
                autoFocus={varNames.indexOf(name) === 0}
              />
            </div>
            );
          })}
          {varNames.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-4">
              此提示词没有变量，直接注入
            </p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-4 py-3 border-t flex justify-between">
          <span className="text-[10px] text-zinc-400 self-center">
            Ctrl+Enter 快速确认
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit}>
              注入
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
