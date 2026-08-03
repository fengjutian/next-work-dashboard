import React, { useEffect, useMemo, useState } from 'react';
import { X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAllCategories, useStore } from '@/store';
import type { Prompt, PromptVariable } from '@/store/types';
import {
  fillPromptVariables,
  normalizePromptTags,
  syncPromptVariables,
} from './domain';

interface PromptEditorDialogProps {
  prompt?: Prompt;
  onClose: () => void;
}

export const PromptEditorDialog: React.FC<PromptEditorDialogProps> = ({ prompt, onClose }) => {
  const addPrompt = useStore((state) => state.addPrompt);
  const updatePrompt = useStore((state) => state.updatePrompt);
  const categories = useAllCategories();
  const [title, setTitle] = useState(prompt?.title ?? '');
  const [content, setContent] = useState(prompt?.content ?? '');
  const [category, setCategory] = useState(prompt?.category ?? categories[0] ?? '通用');
  const [tagsText, setTagsText] = useState(prompt?.tags.join(', ') ?? '');
  const [variables, setVariables] = useState<PromptVariable[]>(() => syncPromptVariables(prompt?.content ?? '', prompt?.variables));
  const [error, setError] = useState('');

  const initialSnapshot = useMemo(() => JSON.stringify({
    title: prompt?.title ?? '',
    content: prompt?.content ?? '',
    category: prompt?.category ?? categories[0] ?? '通用',
    tagsText: prompt?.tags.join(', ') ?? '',
    variables: syncPromptVariables(prompt?.content ?? '', prompt?.variables),
  }), [categories, prompt]);
  const currentSnapshot = JSON.stringify({ title, content, category, tagsText, variables });
  const dirty = currentSnapshot !== initialSnapshot;

  const preview = useMemo(() => fillPromptVariables(
    content,
    Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue])),
  ), [content, variables]);

  const updateContent = (value: string) => {
    setContent(value);
    setVariables((current) => syncPromptVariables(value, current));
    setError('');
  };

  const updateVariable = (name: string, patch: Partial<PromptVariable>) => {
    setVariables((current) => current.map((variable) => (
      variable.name === name ? { ...variable, ...patch } : variable
    )));
  };

  const requestClose = () => {
    if (dirty && !window.confirm('当前修改尚未保存，确定放弃吗？')) return;
    onClose();
  };

  const handleSave = () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError('请输入提示词标题');
      return;
    }
    if (!content.trim()) {
      setError('请输入提示词正文');
      return;
    }

    const now = Date.now();
    const values = {
      title: normalizedTitle,
      content,
      category,
      tags: normalizePromptTags(tagsText),
      variables: syncPromptVariables(content, variables),
    };
    if (prompt) {
      updatePrompt(prompt.id, values);
    } else {
      addPrompt({
        id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        ...values,
        isFavorite: false,
        isPinned: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={requestClose}>
      <div
        className="mx-4 flex max-h-[88vh] w-[920px] flex-col rounded-lg bg-card shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{prompt ? '编辑提示词' : '新建提示词'}</h2>
            <p className="text-[10px] text-muted-foreground">使用 Ctrl+S 快速保存，变量格式为 {'{{变量名}}'}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={requestClose} aria-label="关闭编辑器">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] overflow-hidden">
          <div className="space-y-3 overflow-y-auto border-r p-4">
            <Field label="标题">
              <Input value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} className="h-8" autoFocus />
            </Field>
            <Field label="正文">
              <textarea
                value={content}
                onChange={(event) => updateContent(event.target.value)}
                placeholder="输入提示词正文，可插入 {{变量名}}"
                className="h-56 w-full resize-y rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 ring-ring"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="分类">
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="标签（逗号分隔）">
                <Input value={tagsText} onChange={(event) => setTagsText(event.target.value)} className="h-8" placeholder="代码, 审查" />
              </Field>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto bg-background/60 p-4">
            <h3 className="mb-2 text-xs font-semibold">变量 ({variables.length})</h3>
            {variables.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">在正文中输入 {'{{变量名}}'} 后，可在这里设置默认值和说明。</p>
            ) : (
              <div className="space-y-3">
                {variables.map((variable) => (
                  <div key={variable.name} className="space-y-2 rounded-md border bg-card p-3">
                    <code className="text-xs font-semibold text-primary">{`{{${variable.name}}}`}</code>
                    <Input
                      value={variable.defaultValue}
                      onChange={(event) => updateVariable(variable.name, { defaultValue: event.target.value })}
                      className="h-7 text-xs"
                      placeholder="默认值"
                    />
                    <Input
                      value={variable.description}
                      onChange={(event) => updateVariable(variable.name, { description: event.target.value })}
                      className="h-7 text-xs"
                      placeholder="变量说明"
                    />
                  </div>
                ))}
              </div>
            )}

            <h3 className="mb-2 mt-5 text-xs font-semibold">实时预览</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-xs text-muted-foreground">{preview || '暂无内容'}</pre>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
            {error || (dirty ? '有未保存的修改' : '没有修改')}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={requestClose}>取消</Button>
            <Button size="sm" onClick={handleSave}>保存</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
);
