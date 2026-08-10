/**
 * MarkdownStatusBar — 状态栏。
 *
 * 显示：保存状态、字数 / 行数、编码、换行符、往返安全、外部变化提示。
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { MarkdownDocument, RoundtripReport } from '../types';

export interface MarkdownStatusBarProps {
  document: MarkdownDocument | null;
  roundtrip: RoundtripReport;
  saving: boolean;
}

export const MarkdownStatusBar: React.FC<MarkdownStatusBarProps> = ({ document, roundtrip, saving }) => {
  if (!document) {
    return (
      <div className="flex h-7 flex-shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span>未打开文档</span>
      </div>
    );
  }
  const wordCount = countWords(document.body);
  const lineCount = document.body.split(/\r?\n/).length;
  return (
    <div className="flex h-7 flex-shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
      <span
        className={cn(
          'rounded-sm px-1.5 py-0.5 font-medium',
          document.dirty
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
        )}
      >
        {saving ? '保存中…' : document.dirty ? '未保存' : '已保存'}
      </span>
      {document.externalChange && (
        <span className="rounded-sm bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
          外部已修改
        </span>
      )}
      <span>
        {wordCount.toLocaleString()} 词 · {lineCount.toLocaleString()} 行
      </span>
      <span className="font-mono">{document.encoding}</span>
      <span className="font-mono">{document.lineEnding.toUpperCase()}</span>
      <span
        className={cn(
          'ml-auto rounded-sm px-1.5 py-0.5 font-medium',
          roundtrip.severity === 'safe' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
          roundtrip.severity === 'lossy' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
          roundtrip.severity === 'unsafe' && 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
        )}
        title={roundtrip.issues.map((i) => i.message).join('\n') || '往返安全'}
      >
        往返：{describeRoundtrip(roundtrip.severity)}
      </span>
    </div>
  );
};

function describeRoundtrip(severity: RoundtripReport['severity']): string {
  if (severity === 'safe') return '安全';
  if (severity === 'lossy') return '轻微差异';
  return '可能丢失';
}

function countWords(text: string): number {
  if (!text) return 0;
  // 中文按字符计数（去除空白）
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;
  return cjk + latin;
}
