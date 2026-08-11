/**
 * BacklinksPanel — 显示当前文档的反向引用。
 *
 * 通过 `activeKnowledgeWorkspace.backlinks(relativePath)` 拉取结果。
 * 仅在文档属于工作区（rootPath !== null）时生效。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Network, ExternalLink } from '@/components/icons';
import { cn } from '@/lib/utils';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import type { MarkdownDocument } from '../types';

export interface BacklinksPanelProps {
  document: MarkdownDocument;
}

interface BacklinkRow {
  sourcePath?: string;
  sourceTitle?: string;
  line: number;
  target: string;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({ document }) => {
  const [rows, setRows] = useState<BacklinkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!document.rootPath) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await activeKnowledgeWorkspace.backlinks(document.relativePath);
      setRows(results.map((item) => ({
        sourcePath: item.sourcePath,
        sourceTitle: item.sourceTitle,
        line: item.line,
        target: item.target,
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [document.rootPath, document.relativePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!document.rootPath) {
    return (
      <section>
        <header className="flex h-9 items-center gap-2 border-b px-3 text-xs font-semibold text-muted-foreground">
          <Network className="h-3.5 w-3.5" />
          <span>反向引用</span>
        </header>
        <p className="px-3 py-3 text-xs text-muted-foreground">当前文档不在知识工作区中，无法解析 Backlink</p>
      </section>
    );
  }

  return (
    <section>
      <header className="flex h-9 items-center gap-2 border-b px-3 text-xs font-semibold text-muted-foreground">
        <Network className="h-3.5 w-3.5" />
        <span>反向引用</span>
        <span className="ml-auto text-[10px] font-normal">{rows.length} 条</span>
      </header>
      {loading ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">正在扫描…</p>
      ) : error ? (
        <p className="px-3 py-3 text-xs text-rose-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">没有其他文档引用本页</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row, index) => (
            <li key={`${row.sourcePath}-${row.line}-${index}`} className="flex items-center gap-2 px-3 py-2 text-xs">
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{row.sourceTitle ?? row.sourcePath}</div>
                <div className="truncate text-muted-foreground">
                  L{row.line} · {row.target}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// re-export classnames helper for consumers that use cn
export { cn };
