import React from 'react';
import { FileText, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { WorkspaceSearchResult } from '@/types/electron';

interface SearchPanelState {
  open: boolean;
  query: string;
  include: string;
  exclude: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  replacement: string;
  loading: boolean;
  results: WorkspaceSearchResult[];
}

interface SearchPanelProps {
  searchPanel: SearchPanelState;
  setSearchPanel: React.Dispatch<React.SetStateAction<SearchPanelState>>;
  runSearch: () => Promise<void>;
  replaceAllSearchResults: () => Promise<void>;
  openSearchResult: (result: WorkspaceSearchResult) => Promise<void>;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchPanel,
  setSearchPanel,
  runSearch,
  replaceAllSearchResults,
  openSearchResult,
}) => {
  if (!searchPanel.open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-16" onMouseDown={() => setSearchPanel((previous) => ({ ...previous, open: false }))}>
      <div className="w-[min(720px,85vw)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={searchPanel.query}
            onChange={(event) => setSearchPanel((previous) => ({ ...previous, query: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch();
            }}
            placeholder="在工作区文件内容中搜索"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="button"
            className={`rounded px-1.5 py-1 font-mono text-xs ${searchPanel.caseSensitive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
            onClick={() => setSearchPanel((previous) => ({ ...previous, caseSensitive: !previous.caseSensitive }))}
            title="区分大小写"
          >
            Aa
          </button>
          <button type="button" className={`rounded px-1.5 py-1 font-mono text-xs ${searchPanel.wholeWord ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'}`} onClick={() => setSearchPanel((previous) => ({ ...previous, wholeWord: !previous.wholeWord }))} title="全字匹配">ab</button>
          <button type="button" className={`rounded px-1.5 py-1 font-mono text-xs ${searchPanel.useRegex ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'}`} onClick={() => setSearchPanel((previous) => ({ ...previous, useRegex: !previous.useRegex }))} title="使用正则表达式">.*</button>
          <Button size="sm" className="h-7 px-3 text-xs" disabled={!searchPanel.query.trim() || searchPanel.loading} onClick={() => void runSearch()}>
            {searchPanel.loading ? '搜索中…' : '搜索'}
          </Button>
          <kbd className="text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="grid grid-cols-2 gap-2 border-b px-3 py-2">
          <input value={searchPanel.include} onChange={(event) => setSearchPanel((previous) => ({ ...previous, include: event.target.value }))} placeholder="包含文件，例如 src,.ts" className="h-8 rounded border bg-background px-2 text-xs outline-none" />
          <input value={searchPanel.exclude} onChange={(event) => setSearchPanel((previous) => ({ ...previous, exclude: event.target.value }))} placeholder="排除文件，例如 dist,.min.js" className="h-8 rounded border bg-background px-2 text-xs outline-none" />
        </div>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <input value={searchPanel.replacement} onChange={(event) => setSearchPanel((previous) => ({ ...previous, replacement: event.target.value }))} placeholder="替换为" className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none" />
          <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={searchPanel.loading || searchPanel.results.length === 0} onClick={() => void replaceAllSearchResults()}>全部替换</Button>
        </div>
        <div className="max-h-[420px] overflow-auto py-1">
          {searchPanel.results.map((result, index) => (
            <button
              type="button"
              key={`${result.path}:${result.line}:${result.column}:${index}`}
              className="flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              onClick={() => void openSearchResult(result)}
            >
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="w-52 shrink-0 truncate font-medium" title={result.path}>
                {result.path}:{result.line}:{result.column}
              </span>
              <span className="truncate font-mono text-muted-foreground">{result.preview}</span>
            </button>
          ))}
          {!searchPanel.loading && searchPanel.query && searchPanel.results.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">没有搜索结果</div>
          )}
        </div>
      </div>
    </div>
  );
};
