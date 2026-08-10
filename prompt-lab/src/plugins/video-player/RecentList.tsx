/**
 * 最近播放列表
 *
 * 渲染进程 localStorage 持久化，组件内提供删除 / 清空操作。
 */

import { useState } from 'react';
import { Trash2, X, History, Film } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { RecentVideoEntry } from './types';
import { clearRecent, loadRecent, removeRecent } from './recent-store';
import { fileBaseName, fileDirName, formatDuration } from './format';

interface RecentListProps {
  entries?: RecentVideoEntry[];
  onPick: (entry: RecentVideoEntry) => void;
  onClose?: () => void;
}

export function RecentList({ entries: propEntries, onPick, onClose }: RecentListProps) {
  const [localEntries, setLocalEntries] = useState<RecentVideoEntry[]>(() => loadRecent());
  const entries = propEntries ?? localEntries;

  const refresh = () => {
    if (propEntries === undefined) setLocalEntries(loadRecent());
  };

  const handleRemove = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = removeRecent(path);
    if (propEntries === undefined) setLocalEntries(next);
  };

  const handleClear = () => {
    clearRecent();
    refresh();
  };

  return (
    <aside className="flex flex-col h-full bg-card border-l w-72">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-primary" />
          最近播放
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              title="清空列表"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button type="button" variant="ghost" size="icon" onClick={onClose} title="关闭侧栏">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground px-6 py-12 text-center">
            <Film className="h-10 w-10 text-muted-foreground/40 mb-3" />
            还没有播放记录
            <span className="mt-1">打开一个视频文件后会自动加入这里</span>
          </div>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => (
              <li
                key={entry.path}
                onClick={() => onPick(entry)}
                className="group flex items-start gap-2 px-3 py-2 hover:bg-accent cursor-pointer"
              >
                <Film className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate" title={entry.name}>
                    {entry.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate" title={entry.path}>
                    {fileDirName(entry.path)}
                  </div>
                  <div className="text-xs text-muted-foreground/80 mt-0.5 tabular-nums">
                    {formatDuration(entry.duration)} · {new Date(entry.lastPlayedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleRemove(entry.path, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                  title="从列表移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
