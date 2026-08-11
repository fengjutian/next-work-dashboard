/**
 * PerspectiveCard — 单张星座卡片
 *
 * 支持：折叠/展开、复制、追问入口、流式占位、错误状态、差异高亮。
 */

import { useState } from 'react';
import { ChevronDown, Copy, MessageSquare, RefreshCw, Star } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ZODIAC_META } from '../zodiac-data';
import type { CardStatus, ZodiacPerspective, ZodiacRun, ZodiacSign } from '../zodiac-types';
import { buildSinglePerspectiveMarkdown, copyText } from '../zodiac-copy';
import type { FeedbackKind } from '../zodiac-quality';

export interface PerspectiveCardProps {
  sign: ZodiacSign;
  status: CardStatus;
  perspective?: ZodiacPerspective;
  streamedInterpretation?: string;
  error?: string;
  /** 是否相对共识"有差异"——UI 高亮 */
  isOutlier?: boolean;
  run: ZodiacRun;
  onFollowup: (sign: ZodiacSign) => void;
  onRetry: (sign: ZodiacSign) => void;
  onCopy: (text: string, success: boolean) => void;
  onFeedback: (sign: ZodiacSign, kind: FeedbackKind) => void;
}

export function PerspectiveCard({
  sign,
  status,
  perspective,
  error,
  isOutlier,
  run,
  onFollowup,
  onRetry,
  onCopy,
  onFeedback,
}: PerspectiveCardProps) {
  const meta = ZODIAC_META[sign];
  const [expanded, setExpanded] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);

  const handleCopy = async () => {
    if (!perspective) return;
    const ok = await copyText(buildSinglePerspectiveMarkdown(run, perspective));
    onCopy(`已复制 ${meta.name} 视角`, ok);
  };

  return (
    <article
      className={
        'group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md ' +
        (isOutlier ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border/60')
      }
      data-sign={sign}
      data-status={status}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-2xl" aria-hidden>
            {meta.glyph}
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {meta.name}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{meta.englishName}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              {meta.keywords.join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isOutlier && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              差异
            </span>
          )}
          {status === 'done' && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              完成
            </span>
          )}
          {status === 'streaming' && (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              生成中
            </span>
          )}
          {status === 'failed' && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              失败
            </span>
          )}
          {status === 'pending' && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              等待
            </span>
          )}
        </div>
      </header>

      {status === 'failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error || '本次生成失败，可点击「重试」重新请求该视角。'}
        </div>
      )}

      {(status === 'done' || status === 'streaming') && (
        <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">如何理解</h4>
            {status === 'streaming' && !perspective ? (
              <div className="mt-2 space-y-2" role="status" aria-label={`${meta.name}正在生成`}>
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                <span className="sr-only">正在生成结构化回答</span>
              </div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap">{perspective?.interpretation}</p>
            )}
          </div>

          {perspective && expanded && (
            <>
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">最关注什么</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {perspective.focus.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">建议怎么做</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {perspective.advice.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
              {perspective.caution && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                  <Star className="mr-1 inline h-3 w-3" /> {perspective.caution}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {status === 'pending' && (
        <p className="text-sm text-muted-foreground">尚未开始…</p>
      )}

      {perspective && (
        <footer className="space-y-2 border-t border-border/40 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => !prev)}>
            <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (expanded ? 'rotate-180' : '')} />
            {expanded ? '收起' : '展开'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" /> 复制
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onFollowup(sign)}>
            <MessageSquare className="h-3.5 w-3.5" /> 以此视角追问
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onRetry(sign)} disabled={status === 'streaming'}>
            <RefreshCw className="h-3.5 w-3.5" /> 重试
          </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>这条回答：</span>
            {FEEDBACK_OPTIONS.map((item) => (
              <button key={item.kind} type="button" onClick={() => { setFeedback(item.kind); onFeedback(sign, item.kind); }} className={'rounded-full border px-2 py-0.5 ' + (feedback === item.kind ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 hover:bg-muted')}>{item.label}</button>
            ))}
          </div>
        </footer>
      )}

      {status === 'failed' && (
        <footer className="flex items-center gap-1.5 border-t border-border/40 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onRetry(sign)}>
            <RefreshCw className="h-3.5 w-3.5" /> 重试
          </Button>
          <span className="text-xs text-muted-foreground">其他视角不受影响</span>
        </footer>
      )}
    </article>
  );
}

const FEEDBACK_OPTIONS: Array<{ kind: FeedbackKind; label: string }> = [
  { kind: 'helpful', label: '有启发' }, { kind: 'repetitive', label: '太重复' },
  { kind: 'offPersona', label: '不符合视角' }, { kind: 'notActionable', label: '建议不具体' },
];
