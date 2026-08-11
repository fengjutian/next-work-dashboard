/**
 * SynthesisPanel — 对比总结（共识 / 分歧 / 盲点 / 行动建议）
 */

import { useState } from 'react';
import { ChevronDown, Copy, Loader2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buildSynthesisMarkdown, copyText } from '../zodiac-copy';
import type { SynthesisStatus, ZodiacRun, ZodiacSynthesis } from '../zodiac-types';
import { ZODIAC_META } from '../zodiac-data';

export interface SynthesisPanelProps {
  run: ZodiacRun;
  status: SynthesisStatus;
  synthesis: ZodiacSynthesis | null;
  error?: string;
  onCopy: (text: string, success: boolean) => void;
  onRetry?: () => void;
}

export function SynthesisPanel({ run, status, synthesis, error, onCopy, onRetry }: SynthesisPanelProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!run.options.includeSynthesis) {
    return (
      <section className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
        已在选项中关闭"生成对比总结"。
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm" aria-label="对比总结">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">圆桌纪要</h3>
        {synthesis && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const ok = await copyText(buildSynthesisMarkdown(run));
              onCopy('已复制圆桌纪要', ok);
            }}
          >
            <Copy className="h-3.5 w-3.5" /> 复制总结
          </Button>
        )}
      </header>

      {status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4" />
          正在基于 12 份视角生成总结…
        </div>
      )}

      {status === 'idle' && run.perspectives.length < 4 && (
        <p className="text-sm text-muted-foreground">需要至少 4 个成功视角才能生成总结。</p>
      )}

      {status === 'idle' && run.perspectives.length >= 4 && !synthesis && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{run.perspectives.length === 12 ? '视角内容已更新，原总结已失效。' : '等待更多视角完成后生成总结。'}</span>
          {run.perspectives.length === 12 && onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>重新生成总结</Button>
          )}
        </div>
      )}

      {status === 'skipped' && (
        <p className="text-sm text-muted-foreground">已跳过（成功视角不足 4 个）。</p>
      )}

      {status === 'failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          汇总生成失败：{error || '未知错误'}
          {onRetry && (
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={onRetry}>
                <Loader2 className="h-3.5 w-3.5" /> 重试
              </Button>
            </div>
          )}
        </div>
      )}

      {synthesis && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Subsection title="共识" items={synthesis.consensus} />
          <Subsection
            title="主要分歧"
            items={synthesis.disagreements.flatMap((d) => [
              `· ${d.topic}`,
              ...d.positions.map((p) => `    — ${p}`),
            ])}
          />
          <Subsection title="容易忽略的盲点" items={synthesis.blindSpots} />
          <Subsection title="综合行动建议" items={synthesis.nextSteps} />
          {synthesis.distinctiveViews?.length ? (
            <Subsection
              title="独特视角"
              items={synthesis.distinctiveViews.map((item) => `${ZODIAC_META[item.sign].name}：${item.difference}`)}
            />
          ) : null}
        </div>
      )}

      {synthesis && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <button
            type="button"
            onClick={() => setShowRaw((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={'h-3 w-3 transition-transform ' + (showRaw ? 'rotate-180' : '')} />
            {showRaw ? '收起 JSON' : '查看原始 JSON'}
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
              {JSON.stringify(synthesis, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

interface SubsectionProps {
  title: string;
  items: string[];
}

function Subsection({ title, items }: SubsectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
        {items.map((item, index) => (
          <li key={index} className="whitespace-pre-wrap">{item}</li>
        ))}
      </ul>
    </div>
  );
}
