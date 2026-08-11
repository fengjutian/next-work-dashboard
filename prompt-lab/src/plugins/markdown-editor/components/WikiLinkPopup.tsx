/**
 * WikiLinkPopup — [[ 候选项浮层。
 */

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { FileText, Plus } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface WikiLinkItem {
  id: string;
  target: string;
  label: string;
  hint?: string;
  isCreate?: boolean;
}

export interface WikiLinkPopupProps {
  items: WikiLinkItem[];
  command: (item: WikiLinkItem) => void;
  clientRect?: (() => DOMRect | null) | null;
  query?: string;
}

export interface WikiLinkPopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

export const WikiLinkPopup = forwardRef<WikiLinkPopupHandle, WikiLinkPopupProps>(({ items, command }, ref) => {
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
      <div className="w-80 rounded-md border bg-popover p-3 text-xs text-muted-foreground shadow-lg">
        输入关键词或文档标题…
      </div>
    );
  }

  return (
    <div className="w-80 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
      {items.map((item, index) => {
        const Icon = item.isCreate ? Plus : FileText;
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
              <div className="truncate font-medium">{item.label}</div>
              {item.hint && <div className="truncate text-[10px] text-muted-foreground">{item.hint}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
});

WikiLinkPopup.displayName = 'WikiLinkPopup';
