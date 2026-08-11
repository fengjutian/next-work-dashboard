import { X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ZODIAC_META } from '../zodiac-data';
import { getQualityStats } from '../zodiac-quality';

const percent = (value: number) => `${Math.round(value * 100)}%`;
export function QualityStatsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const stats = getQualityStats();
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="质量统计">
    <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl border border-border bg-card p-4 shadow-2xl">
      <header className="flex items-center justify-between"><div><h2 className="font-semibold">质量统计</h2><p className="text-xs text-muted-foreground">仅包含本地匿名质量数据，不保存问题原文。</p></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></header>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="生成轮次" value={String(stats.runCount)} /><Metric label="格式成功率" value={percent(stats.formatSuccessRate)} /><Metric label="快速补全率" value={percent(stats.fastFallbackRate)} /><Metric label="平均生成时间" value={`${(stats.averageDurationMs / 1000).toFixed(1)} 秒`} />
      </div>
      <h3 className="mt-5 text-sm font-medium">各星座满意率</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">{stats.bySign.map((item) => <div key={item.sign} className="rounded border p-2 text-xs"><span>{ZODIAC_META[item.sign].glyph} {ZODIAC_META[item.sign].name}</span><strong className="float-right">{item.total ? percent(item.satisfaction) : '暂无'}</strong><div className="text-muted-foreground">{item.total} 条反馈</div></div>)}</div>
      <h3 className="mt-5 text-sm font-medium">不同场景重复率</h3>
      <div className="mt-2 space-y-1 text-sm">{stats.scenes.length ? stats.scenes.map((item) => <div key={item.scene} className="flex justify-between rounded border px-3 py-2"><span>{item.scene}</span><span>{percent(item.repeatRate)}</span></div>) : <p className="text-muted-foreground">暂无生成记录</p>}</div>
    </div>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>; }
