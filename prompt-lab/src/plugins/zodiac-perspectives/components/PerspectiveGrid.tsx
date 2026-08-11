/**
 * PerspectiveGrid — 12 张卡片网格 + 单列切换 + "只看差异"模式
 */

import { Columns2, Rows3, Search, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { PerspectiveCardState, ZodiacRun, ZodiacSign } from '../zodiac-types';
import { ZODIAC_SIGNS } from '../zodiac-types';
import { PerspectiveCard } from './PerspectiveCard';
import type { FeedbackKind } from '../zodiac-quality';

export type LayoutMode = 'grid' | 'list';
export type DifferenceFilter = 'all' | 'outliers';

export interface PerspectiveGridProps {
  cards: PerspectiveCardState[];
  outlierSigns: ZodiacSign[];
  run: ZodiacRun;
  layout: LayoutMode;
  differenceFilter: DifferenceFilter;
  onLayoutChange: (layout: LayoutMode) => void;
  onDifferenceFilterChange: (filter: DifferenceFilter) => void;
  onFollowup: (sign: ZodiacSign) => void;
  onRetry: (sign: ZodiacSign) => void;
  onCopy: (text: string, success: boolean) => void;
  onFeedback: (sign: ZodiacSign, kind: FeedbackKind) => void;
}

export function PerspectiveGrid({
  cards,
  outlierSigns,
  run,
  layout,
  differenceFilter,
  onLayoutChange,
  onDifferenceFilterChange,
  onFollowup,
  onRetry,
  onCopy,
  onFeedback,
}: PerspectiveGridProps) {
  const outlierSet = new Set(outlierSigns);
  const sorted = ZODIAC_SIGNS
    .map((sign) => cards.find((card) => card.sign === sign))
    .filter((card): card is PerspectiveCardState => Boolean(card));

  const visible = sorted.filter((card) => {
    if (differenceFilter === 'outliers') return outlierSet.has(card.sign);
    return true;
  });

  const completedCount = sorted.filter((card) => card.status === 'done').length;
  const failedCount = sorted.filter((card) => card.status === 'failed').length;

  return (
    <section className="space-y-3" aria-label="十二星座视角">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>已完成 {completedCount} / {cards.length}</span>
          {failedCount > 0 && <span className="text-destructive">· 失败 {failedCount}</span>}
          {outlierSigns.length > 0 && <span>· 差异 {outlierSigns.length}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={differenceFilter === 'outliers' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onDifferenceFilterChange(differenceFilter === 'outliers' ? 'all' : 'outliers')}
            disabled={outlierSigns.length === 0}
          >
            {differenceFilter === 'outliers' ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            {differenceFilter === 'outliers' ? '显示全部' : '只看差异'}
          </Button>
          <Button
            variant={layout === 'grid' ? 'default' : 'ghost'}
            size="icon"
            onClick={() => onLayoutChange('grid')}
            aria-label="网格布局"
          >
            <Columns2 className="h-4 w-4" />
          </Button>
          <Button
            variant={layout === 'list' ? 'default' : 'ghost'}
            size="icon"
            onClick={() => onLayoutChange('list')}
            aria-label="单列布局"
          >
            <Rows3 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {differenceFilter === 'outliers'
            ? '当前结果未识别出明显差异视角。'
            : '暂无视角可显示。'}
        </div>
      ) : (
        <div
          className={
            layout === 'grid'
              ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-3'
          }
        >
          {visible.map((card) => (
            <PerspectiveCard
              key={card.sign}
              sign={card.sign}
              status={card.status}
              perspective={card.perspective}
              streamedInterpretation={card.streamedInterpretation}
              error={card.error}
              isOutlier={outlierSet.has(card.sign)}
              run={run}
              onFollowup={onFollowup}
              onRetry={onRetry}
              onCopy={onCopy}
              onFeedback={onFeedback}
            />
          ))}
        </div>
      )}
    </section>
  );
}
