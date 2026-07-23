import React, { useRef } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import type { Prompt } from '@/store';

// ── 导出为 JSON ──

function exportJSON(prompts: Prompt[]): string {
  return JSON.stringify(
    prompts.map((p) => ({
      title: p.title,
      content: p.content,
      category: p.category,
      tags: p.tags,
      variables: p.variables,
    })),
    null,
    2
  );
}

// ── 导出为 Markdown ──

function exportMarkdown(prompts: Prompt[]): string {
  return prompts
    .map(
      (p) =>
        `## ${p.title}\n\n> 分类：${p.category}  ·  标签：${p.tags.join(', ')}\n\n${p.content}\n\n---\n`
    )
    .join('\n');
}

// ── 解析导入的 JSON ──

function parseImportJSON(raw: string): Partial<Prompt>[] | null {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.filter(
      (item) =>
        typeof item.title === 'string' &&
        typeof item.content === 'string'
    );
  } catch {
    return null;
  }
}

// ── 组件 ──

export const ImportExport: React.FC = () => {
  const { prompts, addPrompt } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = (format: 'json' | 'md') => {
    const content =
      format === 'json' ? exportJSON(prompts) : exportMarkdown(prompts);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompts.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const items = parseImportJSON(text);
      if (!items) {
        alert('无法解析文件，请确保是有效的 JSON 格式');
        return;
      }

      const existing = useStore.getState().prompts;
      let added = 0;
      let skipped = 0;

      items.forEach((item) => {
        // 跳过重复标题
        if (existing.some((p) => p.title === item.title)) {
          skipped++;
          return;
        }

        const now = Date.now();
        addPrompt({
          id: `import-${now}-${Math.random().toString(36).slice(2, 6)}`,
          title: item.title!,
          content: item.content!,
          category: item.category ?? '通用',
          tags: item.tags ?? [],
          variables: item.variables ?? [],
          isFavorite: false,
          isPinned: false,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        added++;
      });

      alert(`导入完成：新增 ${added} 条，跳过 ${skipped} 条（重复标题）`);
    };
    reader.readAsText(file);

    // 重置 input 以便重复选择同一文件
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => handleExport('json')}
      >
        <Download className="h-3 w-3" />
        导出 JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => handleExport('md')}
      >
        <Download className="h-3 w-3" />
        导出 MD
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-3 w-3" />
        导入 JSON
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />
    </div>
  );
};
