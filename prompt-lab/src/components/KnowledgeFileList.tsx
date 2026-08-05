import React, { useMemo, useState } from 'react';
import { Calendar, ChevronDown, FileText, FolderOpen, Trash2 } from './icons';
import type { ConversationFile, ConversationSearchResult } from '@/types/electron';

export interface KnowledgeFileFolder { name: string; path: string }

interface KnowledgeFileListProps {
  files: ConversationFile[];
  folders?: KnowledgeFileFolder[];
  query?: string;
  searchResults?: ConversationSearchResult[];
  mode?: 'browse' | 'select';
  activePath?: string | null;
  selectedPaths?: Set<string>;
  onOpen?: (file: ConversationFile) => void;
  onToggle?: (path: string, checked: boolean) => void;
  onDelete?: (file: ConversationFile) => void;
  onContextMenu?: (event: React.MouseEvent, file: ConversationFile) => void;
  emptyMessage?: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return <>{parts.map((part, index) => part.toLocaleLowerCase() === query.toLocaleLowerCase()
    ? <mark key={index} className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700">{part}</mark>
    : part)}</>;
}

export const KnowledgeFileList: React.FC<KnowledgeFileListProps> = ({
  files, folders = [], query = '', searchResults, mode = 'browse', activePath,
  selectedPaths = new Set(), onOpen, onToggle, onDelete, onContextMenu,
  emptyMessage = '知识库暂无文件',
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const resultByPath = useMemo(() => new Map(searchResults?.map((result) => [result.file.path, result]) ?? []), [searchResults]);
  const displayedFiles = searchResults ? searchResults.map((result) => result.file) : files;
  const groups = useMemo(() => {
    const grouped = new Map<string, ConversationFile[]>();
    grouped.set('', []);
    folders.forEach((folder) => grouped.set(folder.path, []));
    displayedFiles.forEach((file) => {
      const folder = file.folder ?? '';
      if (!grouped.has(folder)) grouped.set(folder, []);
      grouped.get(folder)!.push(file);
    });
    return [...grouped.entries()].filter(([folder, items]) => !query || items.length > 0 || folder === '');
  }, [displayedFiles, folders, query]);

  if (displayedFiles.length === 0 && (query || folders.length === 0)) {
    return <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><FileText className="h-8 w-8" /><p className="text-xs">{emptyMessage}</p></div>;
  }

  return <div className="h-full overflow-y-auto">
    {groups.map(([folder, items]) => {
      const collapsed = collapsedFolders.has(folder);
      return <section key={folder || '__root'}>
        <button type="button" className="flex h-8 w-full items-center gap-1.5 border-b bg-muted/40 px-2 text-left text-[11px] font-medium hover:bg-accent"
          onClick={() => setCollapsedFolders((current) => { const next = new Set(current); next.has(folder) ? next.delete(folder) : next.add(folder); return next; })}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
          <span className="min-w-0 flex-1 truncate" title={folder}>{folder || '未分类'}</span>
          <span className="text-[10px] font-normal text-muted-foreground">{items.length}</span>
        </button>
        {!collapsed && (items.length ? items.map((file) => {
          const result = resultByPath.get(file.path);
          const selected = selectedPaths.has(file.path);
          return <div key={file.path} className={`group border-b border-border px-3 py-2 text-xs transition-colors ${activePath === file.path || selected ? 'bg-primary-light text-primary' : 'text-muted-foreground hover:bg-accent/50'}`}
            onContextMenu={(event) => onContextMenu?.(event, file)}>
            <div className="flex cursor-pointer items-start gap-2" onClick={() => mode === 'select' ? onToggle?.(file.path, !selected) : onOpen?.(file)}>
              {mode === 'select' ? <input type="checkbox" checked={selected} onChange={(event) => onToggle?.(file.path, event.target.checked)} onClick={(event) => event.stopPropagation()} className="mt-0.5 h-3.5 w-3.5 rounded border-input" /> : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground"><Highlight text={file.title || file.fileName} query={query} /></div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px]"><Calendar className="h-3 w-3" /> {file.date}{mode === 'browse' && ` · ${(file.size / 1024).toFixed(1)} KB`}{result && <span className="text-primary">{result.matchCount} 处</span>}</div>
                {result?.snippets[0] && <div className="mt-1 line-clamp-2 text-[10px] leading-4" title={`第 ${result.snippets[0].line} 行`}><Highlight text={result.snippets[0].text} query={query} /></div>}
              </div>
              {mode === 'browse' && onDelete && <button className="invisible p-0.5 text-muted-foreground hover:text-destructive group-hover:visible" onClick={(event) => { event.stopPropagation(); onDelete(file); }} title="删除"><Trash2 className="h-3 w-3" /></button>}
            </div>
          </div>;
        }) : <p className="border-b px-8 py-2 text-[10px] text-muted-foreground">空目录</p>)}
      </section>;
    })}
  </div>;
};
