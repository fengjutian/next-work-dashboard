/**
 * MarkdownOutline — 大纲视图，从 markdown 正文提取 # ~ ###### 标题。
 *
 * 实时根据 active document.body 计算。
 * 选中某项会通知父组件滚动到对应行。
 */
import React, { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { List } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument } from '../types';

export interface MarkdownOutlineProps {
  document: MarkdownDocument | null;
  activeLine: number;
  onJump: (line: number) => void;
}

interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

function extractOutline(body: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    items.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
  }
  return items;
}

export const MarkdownOutline: React.FC<MarkdownOutlineProps> = ({ document, activeLine, onJump }) => {
  const items = useMemo(() => (document ? extractOutline(document.body) : []), [document]);
  if (!document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <List className="h-5 w-5 opacity-50" />
        <span>未打开任何文档</span>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <List className="h-5 w-5 opacity-50" />
        <span>当前文档没有标题</span>
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-2">
        {items.map((item, index) => {
          const isActive = activeLine >= item.line && (index === items.length - 1 || activeLine < items[index + 1].line);
          return (
            <button
              key={`${item.line}-${item.text}`}
              type="button"
              onClick={() => onJump(item.line)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-foreground',
                isActive && 'bg-accent/70 text-foreground',
              )}
              style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
              title={`第 ${item.line} 行`}
            >
              <span className="font-mono text-[10px] text-muted-foreground/80">H{item.level}</span>
              <span className="truncate">{item.text}</span>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
};
