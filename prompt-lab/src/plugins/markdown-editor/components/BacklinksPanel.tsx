/**
 * BacklinksPanel — 展示当前文档的 Backlink（来自 knowledge-workspace）。
 *
 * 复用 activeKnowledgeWorkspace.backlinks(path) — 不维护独立索引。
 */
import React, { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Info } from '@/components/icons';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { cn } from '@/lib/utils';

export interface BacklinksPanelProps {
  rootPath: string | null;
  relativePath: string;
  onJump: (request: { path: string; line: number }) => void;
}

interface BacklinkEntry {
  sourceUri: string;
  sourcePath?: string;
  sourceTitle?: string;
  line: number;
  target: string;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({ rootPath, relativePath, onJump }) => {
  const [entries, setEntries] = useState<BacklinkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setEntries([]);
    if (!rootPath) {
      setError('未打开任何知识工作区');
      return () => {
        disposed = true;
      };
    }
    setLoading(true);
    setError(null);
    activeKnowledgeWorkspace
      .backlinks(relativePath)
      .then((hits) => {
        if (disposed) return;
        setEntries(
          hits.map((hit) => ({
            sourceUri: hit.sourceUri,
            sourcePath: hit.sourcePath,
            sourceTitle: hit.sourceTitle,
            line: hit.line,
            target: hit.target,
          })),
        );
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : 'Backlink 查询失败');
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [rootPath, relativePath]);

  if (!rootPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <Info className="h-5 w-5 opacity-50" />
        <span>知识工作区未激活</span>
        <span className="text-[10px]">Backlink 由知识工作区扫描提供</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载 Backlink 中…</div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <Info className="h-5 w-5 opacity-50" />
        <span>{error}</span>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <Info className="h-5 w-5 opacity-50" />
        <span>暂无 Backlink</span>
        <span className="text-[10px]">其他文档引用此页面时会显示在这里</span>
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1 p-2">
        {entries.map((entry) => (
          <button
            key={`${entry.sourceUri}:${entry.line}`}
            type="button"
            onClick={() => entry.sourcePath && onJump({ path: entry.sourcePath, line: entry.line })}
            disabled={!entry.sourcePath}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md border bg-card px-2.5 py-1.5 text-left text-xs',
              'hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <span className="font-medium">{entry.sourceTitle ?? entry.sourcePath ?? entry.sourceUri}</span>
            <span className="font-mono text-[10px] text-muted-foreground">第 {entry.line} 行 · {entry.target}</span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
};
