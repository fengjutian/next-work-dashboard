import { ZODIAC_META } from '../zodiac-data';
import type { ZodiacSynthesis } from '../zodiac-types';

export function DecisionSummary({ synthesis }: { synthesis: ZodiacSynthesis }) {
  const disagreement = synthesis.disagreements[0];
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4" aria-label="决策摘要">
      <h3 className="text-sm font-semibold text-foreground">先看结论</h3>
      <p className="mt-1 text-sm text-foreground/90">{synthesis.consensus[0]}</p>
      <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
        <div><span className="font-medium">关键分歧</span><p className="mt-1 text-muted-foreground">{disagreement ? `${disagreement.topic}：${disagreement.positions.join(' / ')}` : '暂无明显分歧'}</p></div>
        <div><span className="font-medium">独特视角</span><p className="mt-1 text-muted-foreground">{synthesis.distinctiveViews?.slice(0, 3).map((item) => ZODIAC_META[item.sign].name).join('、') || '暂无突出项'}</p></div>
        <div><span className="font-medium">推荐下一步</span><p className="mt-1 text-muted-foreground">{synthesis.nextSteps[0]}</p></div>
      </div>
    </section>
  );
}
