import React, { useMemo, useState } from 'react';
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
  replaceResults: (results: WorkspaceSearchResult[]) => Promise<void>;
  undoReplace: () => Promise<void>;
  canUndoReplace: boolean;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchPanel,
  setSearchPanel,
  runSearch,
  replaceAllSearchResults,
  openSearchResult,
  replaceResults,
  undoReplace,
  canUndoReplace,
}) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('code-editor.search-history') ?? '[]'); } catch { return []; }
  });
  const groupedResults = useMemo(() => {
    const groups = new Map<string, WorkspaceSearchResult[]>();
    for (const result of searchPanel.results) groups.set(result.path, [...(groups.get(result.path) ?? []), result]);
    return [...groups.entries()];
  }, [searchPanel.results]);
  const executeSearch = async () => {
    const query = searchPanel.query.trim();
    if (query) {
      const next = [query, ...history.filter((item) => item !== query)].slice(0, 30);
      setHistory(next);
      localStorage.setItem('code-editor.search-history', JSON.stringify(next));
    }
    await runSearch();
  };
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
              if (event.key === 'Enter') void executeSearch();
            }}
            list="code-editor-search-history"
            placeholder="在工作区文件内容中搜索"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
          />
          <datalist id="code-editor-search-history">{history.map((query) => <option key={query} value={query} />)}</datalist>
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
          <Button size="sm" className="h-7 px-3 text-xs" disabled={!searchPanel.query.trim() || searchPanel.loading} onClick={() => void executeSearch()}>
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
          <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={searchPanel.loading || searchPanel.results.length === 0} onClick={() => void replaceResults(searchPanel.results)}>全部替换</Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!canUndoReplace || searchPanel.loading} onClick={() => void undoReplace()}>撤销替换</Button>
        </div>
        <div className="max-h-[420px] overflow-auto py-1">
          {groupedResults.map(([path, results]) => <div key={path}>
            <div className="flex h-8 items-center gap-2 bg-muted/30 px-3 text-xs font-medium"><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; })}><span>{collapsed.has(path) ? '›' : '⌄'}</span><FileText className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate">{path}</span><span className="text-muted-foreground">{results.length}</span></button><button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-accent" onClick={() => void replaceResults(results)}>替换文件</button></div>
            {!collapsed.has(path) && results.map((result, index) => <div key={`${result.line}:${result.column}:${index}`} className="group flex min-h-8 items-start gap-2 py-1.5 pl-9 pr-3 text-xs hover:bg-accent"><button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => void openSearchResult(result)}><span className="w-14 shrink-0 text-right text-muted-foreground">{result.line}:{result.column}</span><span className="truncate font-mono text-muted-foreground">{result.preview}</span></button><button type="button" className="rounded px-1 text-[10px] opacity-0 hover:bg-background group-hover:opacity-100" onClick={() => void replaceResults([result])}>替换</button></div>)}
          </div>)}
          {!searchPanel.loading && searchPanel.query && searchPanel.results.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">没有搜索结果</div>
          )}
        </div>
      </div>
    </div>
  );
};
