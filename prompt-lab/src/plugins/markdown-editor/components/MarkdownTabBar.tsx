/**
 * MarkdownTabBar — 多标签页。
 *
 * 简化设计：最多展示已打开文档的文件名 + dirty 圆点。
 * 超出宽度时横向滚动。
 */
import React from 'react';
import { X } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument } from '../types';

export interface MarkdownTabBarProps {
  documents: MarkdownDocument[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
}

export const MarkdownTabBar: React.FC<MarkdownTabBarProps> = ({
  documents,
  activeId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
}) => {
  if (documents.length === 0) return null;
  return (
    <div className="flex h-9 flex-shrink-0 items-stretch border-b bg-muted/40 overflow-x-auto">
      {documents.map((doc) => {
        const isActive = doc.id === activeId;
        return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'group flex h-full min-w-[120px] max-w-[240px] cursor-pointer items-center gap-2 border-r px-3 text-xs',
              isActive
                ? 'bg-background text-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
            onClick={() => onActivate(doc.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(doc.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const choice = window.prompt('操作：close / others / all', 'close');
              if (choice === 'others') onCloseOthers(doc.id);
              else if (choice === 'all') onCloseAll();
            }}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                doc.dirty ? 'bg-amber-500' : 'bg-emerald-500/0',
              )}
              aria-label={doc.dirty ? '未保存' : '已保存'}
            />
            <span className="truncate font-medium">{doc.fileName}</span>
            {doc.mode === 'source' && (
              <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">源码</span>
            )}
            <button
              type="button"
              aria-label="关闭标签"
              title="关闭"
              onClick={(event) => {
                event.stopPropagation();
                onClose(doc.id);
              }}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
