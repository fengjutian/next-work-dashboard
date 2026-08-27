import React, { useMemo } from 'react';
import { buildUnifiedDiffRows, type InlineDiffSegment, type TextDiffHunk } from '../core/text-diff';

interface UnifiedDiffViewProps {
  original: string;
  modified: string;
  hunks: TextDiffHunk[];
  activeHunk: number;
  hideUnchanged: boolean;
  wordLevel: boolean;
}

function Segments({ segments, fallback, kind }: { segments?: InlineDiffSegment[]; fallback: string; kind: 'delete' | 'insert' }) {
  if (!segments) return <>{fallback}</>;
  return <>{segments.map((segment, index) => {
    const changed = segment.type === kind;
    return <span key={`${index}:${segment.value}`} className={changed ? (kind === 'delete' ? 'bg-red-300/60 dark:bg-red-700/60' : 'bg-green-300/60 dark:bg-green-700/60') : undefined}>{segment.value}</span>;
  })}</>;
}

export const UnifiedDiffView: React.FC<UnifiedDiffViewProps> = ({
  original, modified, hunks, activeHunk, hideUnchanged, wordLevel,
}) => {
  const rows = useMemo(() => buildUnifiedDiffRows(original, modified, hunks, {
    contextLines: 3,
    hideUnchanged,
    wordLevel,
    locale: 'zh-CN',
  }), [hideUnchanged, hunks, modified, original, wordLevel]);

  if (hunks.length === 0) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">没有差异</div>;

  return (
    <div className="h-full overflow-auto bg-background font-mono text-xs leading-5" role="table" aria-label="单栏差异视图">
      {rows.map((row, index) => {
        if (row.kind === 'collapsed') {
          return <div key={`collapsed:${index}`} className="border-y bg-muted/40 px-4 py-1 text-center text-muted-foreground">… 已折叠 {row.collapsedLines} 行未变化内容 …</div>;
        }
        const marker = row.kind === 'delete' ? '-' : row.kind === 'insert' ? '+' : ' ';
        const selected = row.hunkIndex === activeHunk;
        const background = row.kind === 'delete' ? 'bg-red-500/10' : row.kind === 'insert' ? 'bg-green-500/10' : '';
        return (
          <div
            key={`${row.kind}:${row.originalLine ?? ''}:${row.modifiedLine ?? ''}:${index}`}
            data-hunk-index={row.hunkIndex}
            className={`grid min-w-max grid-cols-[3.5rem_3.5rem_1.5rem_minmax(20rem,1fr)] ${background} ${selected ? 'ring-1 ring-inset ring-primary' : ''}`}
            role="row"
          >
            <span className="select-none border-r bg-muted/30 px-2 text-right text-muted-foreground">{row.originalLine ?? ''}</span>
            <span className="select-none border-r bg-muted/30 px-2 text-right text-muted-foreground">{row.modifiedLine ?? ''}</span>
            <span className="select-none px-2 text-muted-foreground">{marker}</span>
            <span className="whitespace-pre-wrap break-words pr-4">
              {row.kind === 'delete' || row.kind === 'insert'
                ? <Segments segments={row.segments} fallback={row.text} kind={row.kind} />
                : row.text}
            </span>
          </div>
        );
      })}
    </div>
  );
};
