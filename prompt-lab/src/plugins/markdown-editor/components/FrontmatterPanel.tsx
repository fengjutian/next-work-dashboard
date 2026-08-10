/**
 * FrontmatterPanel — 展示当前文档的 YAML frontmatter 属性。
 *
 * P0 设计：
 *  - 只读展示。修改通过源码模式或保存时的文本编辑。
 *  - 若无 frontmatter，给出"无 frontmatter"占位。
 *  - title / tags / aliases / type 字段会高亮显示。
 */
import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Info } from '@/components/icons';
import type { FrontmatterAttributes } from '../types';

export interface FrontmatterPanelProps {
  frontmatter: FrontmatterAttributes | null;
  fileName: string;
  encoding: string;
  lineEnding: 'lf' | 'crlf';
  size: number;
}

const HIGHLIGHT_KEYS = new Set(['title', 'type', 'tags', 'aliases']);

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const FrontmatterPanel: React.FC<FrontmatterPanelProps> = ({ frontmatter, fileName, encoding, lineEnding, size }) => {
  if (!frontmatter || !frontmatter.present) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <Info className="h-5 w-5 opacity-50" />
        <span>当前文档没有 frontmatter</span>
        <span className="text-[10px]">使用源码模式可在顶部添加 --- YAML --- 块</span>
      </div>
    );
  }
  const entries = Object.entries(frontmatter.attributes);
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3 text-xs">
        <section className="rounded-md border bg-card p-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">文档信息</h3>
          <dl className="space-y-1">
            <Row label="文件名" value={fileName} />
            <Row label="编码" value={encoding} />
            <Row label="换行符" value={lineEnding.toUpperCase()} />
            <Row label="大小" value={formatSize(size)} />
          </dl>
        </section>
        <section className="rounded-md border bg-card p-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Frontmatter</h3>
          {entries.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">（空 frontmatter 块）</p>
          ) : (
            <dl className="space-y-1">
              {entries.map(([key, value]) => (
                <Row key={key} label={key} value={renderValue(value)} highlight={HIGHLIGHT_KEYS.has(key)} />
              ))}
            </dl>
          )}
        </section>
      </div>
    </ScrollArea>
  );
};

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-2">
      <dt className="font-mono text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`break-words text-xs ${highlight ? 'font-medium text-foreground' : 'text-foreground/90'}`}>{value}</dd>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
