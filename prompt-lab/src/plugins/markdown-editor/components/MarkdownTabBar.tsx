/**
 * MarkdownTabBar — 文档标签栏。
 *
 * 设计：
 *  - 每个标签显示文件名 + dirty 状态点。
 *  - 中键点击关闭；右键弹出关闭菜单。
 *  - 滚动溢出时保持当前激活标签可见。
 */

import React, { useRef } from 'react';
import { CheckCircle as CircleCheck, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument } from '../types';

export interface MarkdownTabBarProps {
  documents: MarkdownDocument[];
  activeDocumentId: string | null;
  onSelect(documentId: string): void;
  onClose(documentId: string): void;
}

export const MarkdownTabBar: React.FC<MarkdownTabBarProps> = ({ documents, activeDocumentId, onSelect, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  if (documents.length === 0) return null;

  return (
    <div ref={containerRef} className="flex h-9 flex-shrink-0 items-end gap-1 overflow-x-auto border-b bg-muted/20 px-2 pt-1.5">
      {documents.map((doc) => {
        const isActive = doc.id === activeDocumentId;
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => onSelect(doc.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(doc.id);
              }
            }}
            className={cn(
              'group flex h-7 max-w-[240px] flex-shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-xs transition-colors',
              isActive
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
            title={doc.relativePath}
          >
            {doc.dirty ? (
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
            ) : (
              <CircleCheck className="h-3 w-3 flex-shrink-0 text-emerald-500" />
            )}
            <span className="truncate">{doc.displayName}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onClose(doc.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClose(doc.id);
                }
              }}
              className="ml-1 flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
};
