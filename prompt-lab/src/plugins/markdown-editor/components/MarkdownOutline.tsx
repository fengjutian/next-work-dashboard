/**
 * MarkdownOutline — 文档大纲。
 *
 * 从 Markdown 文本里提取 #/##/### 标题，按层级展示。
 * 点击跳转到对应行（源码模式下直接定位；可视化模式下发出滚动请求由 Tiptap 处理）。
 */

import React, { useMemo } from 'react';
import { Rows3 as List } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument } from '../types';

export interface MarkdownOutlineProps {
  activeDocument: MarkdownDocument | null;
}

interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

function extractOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      items.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return items;
}

export const MarkdownOutline: React.FC<MarkdownOutlineProps> = ({ activeDocument }) => {
  const items = useMemo(() => (activeDocument ? extractOutline(activeDocument.content) : []), [activeDocument]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-9 flex-shrink-0 items-center gap-2 border-b px-3 text-xs font-semibold text-muted-foreground">
        <List className="h-3.5 w-3.5" />
        <span>大纲</span>
        <span className="ml-auto text-[10px] font-normal">{items.length} 项</span>
      </header>
      <div className="flex-1 overflow-auto px-2 py-2 text-sm">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">当前文档暂无标题</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item, index) => (
              <li key={`${item.line}-${index}`}>
                <button
                  type="button"
                  onClick={() => jumpTo(item.line)}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1 text-left text-xs hover:bg-accent',
                    item.level === 1 && 'font-semibold',
                    item.level === 2 && 'pl-4',
                    item.level === 3 && 'pl-6',
                    item.level >= 4 && 'pl-8 text-muted-foreground',
                  )}
                  title={`第 ${item.line} 行`}
                >
                  <span className="mr-2 text-[10px] text-muted-foreground">H{item.level}</span>
                  <span className="truncate">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

function jumpTo(line: number): void {
  const element = document.querySelector('.markdown-editor-surface') as HTMLElement | null;
  if (!element) return;
  // 简化版：按行数估算滚动位置。每行 ~24px（含行高）。
  const targetTop = (line - 1) * 24;
  element.scrollTo({ top: targetTop, behavior: 'smooth' });
}
