/**
 * SlashCommandPopup — / 命令浮层。
 *
 * 由 SlashCommandExtension 通过 ReactRenderer 挂载。
 * 通过 ref.onKeyDown 把键盘事件（↑↓ Enter Esc）透传给 suggestion 框架。
 */

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
  Code as CodeIcon,
  Edit3,
  FileText,
  Rows3 as List,
  Check as ListChecks,
  Rows3 as ListOrdered,
  MessageSquare as Quote,
  Minus,
  Columns2 as Table,
  Image as ImageIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import type { SlashCommandItem } from '../editor/slash-commands';

export type { SlashCommandItem } from '../editor/slash-commands';

export interface SlashCommandPopupProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  clientRect?: (() => DOMRect | null) | null;
  query?: string;
}

export interface SlashCommandPopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  h1: FileText, h2: FileText, h3: FileText, h4: FileText, paragraph: FileText,
  bullet: List, ordered: ListOrdered, task: ListChecks,
  quote: Quote, code: CodeIcon, divider: Minus, table: Table, image: ImageIcon,
};

export const SlashCommandPopup = forwardRef<SlashCommandPopupHandle, SlashCommandPopupProps>(({ items, command }, ref) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }), [items, activeIndex, command]);

  if (items.length === 0) {
    return (
      <div className="w-72 rounded-md border bg-popover p-3 text-xs text-muted-foreground shadow-lg">
        没有匹配的命令
      </div>
    );
  }

  return (
    <div className="w-72 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
      {items.map((item, index) => {
        const Icon = ICON_MAP[item.id] ?? Edit3;
        const isActive = index === activeIndex;
        return (
          <button
            type="button"
            key={item.id}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => command(item)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
              isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            )}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{item.title}</div>
              <div className="truncate text-[10px] text-muted-foreground">{item.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
});

SlashCommandPopup.displayName = 'SlashCommandPopup';
