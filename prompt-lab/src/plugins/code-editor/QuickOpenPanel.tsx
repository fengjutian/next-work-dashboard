import React from 'react';
import { FileText, Search } from '@/components/icons';
import type { TreeNode } from './editor-types';

interface QuickOpenState {
  open: boolean;
  query: string;
  files: TreeNode[];
}

interface QuickOpenPanelProps {
  quickOpen: QuickOpenState;
  setQuickOpen: React.Dispatch<React.SetStateAction<QuickOpenState>>;
  quickOpenResults: TreeNode[];
  openTreeFile: (node: TreeNode, pinned?: boolean) => Promise<void>;
}

export const QuickOpenPanel: React.FC<QuickOpenPanelProps> = ({
  quickOpen,
  setQuickOpen,
  quickOpenResults,
  openTreeFile,
}) => {
  if (!quickOpen.open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-16" onMouseDown={() => setQuickOpen((previous) => ({ ...previous, open: false }))}>
      <div className="w-[min(640px,80vw)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={quickOpen.query}
            onChange={(event) => setQuickOpen((previous) => ({ ...previous, query: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && quickOpenResults[0]) {
                void openTreeFile(quickOpenResults[0]);
                setQuickOpen((previous) => ({ ...previous, open: false }));
              }
            }}
            placeholder="输入文件名快速打开"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-auto py-1">
          {quickOpenResults.map((file) => (
            <button
              type="button"
              key={file.path}
              className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent"
              onClick={() => {
                void openTreeFile(file);
                setQuickOpen((previous) => ({ ...previous, open: false }));
              }}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{file.name}</span>
              <span className="truncate text-muted-foreground">{file.path}</span>
            </button>
          ))}
          {quickOpenResults.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的文件</div>
          )}
        </div>
      </div>
    </div>
  );
};
