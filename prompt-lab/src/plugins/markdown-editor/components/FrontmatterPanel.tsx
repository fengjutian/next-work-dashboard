/**
 * FrontmatterPanel — 显示文档的 YAML frontmatter。
 *
 * 第一版只读展示 + 复制原文。
 * 编辑能力留给 P1（直接编辑 YAML 文本需要小心空格、键名冲突等问题）。
 */

import React, { useMemo } from 'react';
import { Copy, FileText } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { splitFrontmatter } from '../editor/markdown-codec';
import type { MarkdownDocument } from '../types';

export interface FrontmatterPanelProps {
  document: MarkdownDocument;
}

export const FrontmatterPanel: React.FC<FrontmatterPanelProps> = ({ document }) => {
  const { attributes, frontmatter } = useMemo(() => splitFrontmatter(document.content), [document.content]);
  const entries = Object.entries(attributes);

  return (
    <section className="border-b">
      <header className="flex h-9 items-center gap-2 border-b px-3 text-xs font-semibold text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        <span>Frontmatter</span>
        <span className="ml-auto text-[10px] font-normal">{entries.length} 个字段</span>
      </header>
      {!frontmatter ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">当前文档没有 Frontmatter</p>
      ) : (
        <div className="px-3 py-2">
          <ul className="space-y-1 text-xs">
            {entries.map(([key, value]) => (
              <li key={key} className="flex items-baseline gap-2">
                <span className="font-mono text-foreground">{key}</span>
                <span className="text-muted-foreground">:</span>
                <span className="flex-1 truncate font-mono text-foreground/90" title={stringifyValue(value)}>
                  {stringifyValue(value)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(frontmatter)}>
              <Copy className="mr-1 h-3 w-3" />
              复制原文
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}
