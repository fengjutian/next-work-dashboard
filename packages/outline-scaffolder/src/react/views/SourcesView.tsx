import React from "react";
import type { CitationStyle, ContentClassification, EvidenceUsage, SourceCluster } from "../../core/editorial-analysis";
import { locateQuoteContext } from "../../core/editorial-analysis";
import { Button } from "../Button";

interface EvidenceRecord { id: string; title: string; chapter: string; sourceExcerpt?: string; anchor?: { quote: string } }
interface SceneEvidenceCard { id: string; chapter: string; scene: string; time: string; place: string; people: string; objects: string; evidenceIds: string[]; notes: string; updatedAt: number }
interface ChangeLogEntry { id: string; chapter: string; changedAt: number; reason: string; factChanges: string[] }

export interface SourcesViewProps {
  citationStyle: CitationStyle;
  setCitationStyle: (style: CitationStyle) => void;
  hasActiveFile: boolean;
  insertFootnotes: () => void;
  exportBundle: () => void;
  dependentSourceClusters: SourceCluster[];
  evidenceReverseIndex: EvidenceUsage[];
  evidenceRecords: EvidenceRecord[];
  contentClassifications: ContentClassification[];
  sceneEvidenceCards: SceneEvidenceCard[];
  addSceneEvidenceCard: () => void;
  updateSceneEvidenceCard: (id: string, patch: Partial<SceneEvidenceCard>) => void;
  changeLog: ChangeLogEntry[];
}

const LAYER_LABELS = { reconstruction: "合理复原", interpretation: "作者解释", literary: "传说/文学", documented: "材料记载" } as const;
const CERTAINTY_LABELS = { certain: "确定", probable: "较可信", inferred: "推测", legendary: "传说" } as const;

export function SourcesView(p: SourcesViewProps) {
  return <div className="mx-auto mb-5 max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">出版与可追溯工具</h2><p className="text-xs text-muted-foreground">参考文献、脚注、内容分层、修改日志和出版资料包。</p></div><div className="flex gap-2"><select value={p.citationStyle} onChange={(event) => p.setCitationStyle(event.target.value as CitationStyle)} className="rounded border border-input bg-background px-2 text-xs"><option value="gb-t-7714">GB/T 7714</option><option value="chicago-notes">Chicago Notes</option><option value="mla">MLA</option><option value="apa">APA</option></select><Button size="sm" variant="outline" disabled={!p.hasActiveFile} onClick={p.insertFootnotes}>为当前章插入脚注</Button><Button size="sm" onClick={p.exportBundle}>导出出版资料包</Button></div></div></section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">证据反向索引与来源独立性</h3>{p.dependentSourceClusters.map((cluster) => <div key={cluster.key} className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800">{cluster.warning}：{cluster.titles.join("、")}</div>)}<div className="mt-3 max-h-72 space-y-2 overflow-auto">{p.evidenceReverseIndex.map((usage) => { const evidence = p.evidenceRecords.find((item) => item.id === usage.evidenceId); const context = evidence?.anchor?.quote && evidence.sourceExcerpt ? locateQuoteContext(evidence.anchor.quote, evidence.sourceExcerpt) : null; return <div key={usage.evidenceId} className="rounded border border-border p-2 text-xs"><div className="font-medium">{usage.title}</div><div className="text-muted-foreground">章节 {usage.chapters.length} · 主张 {usage.claimIds.length} · 引文 {usage.quotes.length}</div>{context && <div className={`mt-1 rounded p-1 ${context.found ? "bg-emerald-500/[0.06]" : "bg-amber-500/[0.08]"}`}>{context.found ? `${context.before}【${context.quote}】${context.after}` : context.message}</div>}</div>; })}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">史实、解释与文学化分层</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.contentClassifications.filter((item) => item.layer !== "documented").map((item) => <div key={item.id} className="rounded border border-border p-2 text-xs"><div className="flex justify-between"><span>{item.chapter.split("/").pop()}</span><span className="text-primary">{LAYER_LABELS[item.layer]} · {CERTAINTY_LABELS[item.certainty]}</span></div><div className="mt-1 text-muted-foreground">{item.text}</div><div className="mt-1 text-amber-700">{item.reason}</div></div>)}</div></section>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><div className="flex justify-between"><h3 className="font-semibold">场景证据卡</h3><Button size="sm" onClick={p.addSceneEvidenceCard}>新增场景</Button></div>{p.sceneEvidenceCards.map((card) => <div key={card.id} className="mt-3 rounded border border-border p-3"><input value={card.scene} onChange={(event) => p.updateSceneEvidenceCard(card.id, { scene: event.target.value })} className="w-full rounded border border-input bg-background p-2 text-sm font-medium" /><div className="mt-2 grid grid-cols-2 gap-2">{([['time', '时间依据'], ['place', '地点依据'], ['people', '人物依据'], ['objects', '器物/环境依据']] as const).map(([field, placeholder]) => <input key={field} value={card[field]} onChange={(event) => p.updateSceneEvidenceCard(card.id, { [field]: event.target.value })} placeholder={placeholder} className="rounded border border-input bg-background p-2 text-xs" />)}</div><div className="mt-2 flex flex-wrap gap-1">{p.evidenceRecords.filter((item) => !card.chapter || item.chapter === card.chapter).map((item) => <label key={item.id} className="rounded border border-border px-2 py-1 text-[10px]"><input type="checkbox" checked={card.evidenceIds.includes(item.id)} onChange={() => p.updateSceneEvidenceCard(card.id, { evidenceIds: card.evidenceIds.includes(item.id) ? card.evidenceIds.filter((id) => id !== item.id) : [...card.evidenceIds, item.id] })} /> {item.title}</label>)}</div></div>)}</section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">可追溯修改日志 <span className="text-xs font-normal text-muted-foreground">{p.changeLog.length} 条</span></h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.changeLog.map((item) => <div key={item.id} className="rounded border border-border p-2 text-xs"><div className="flex justify-between"><span className="font-medium">{item.chapter.split("/").pop()}</span><span className="text-muted-foreground">{new Date(item.changedAt).toLocaleString()}</span></div><div className="mt-1">{item.reason}</div>{item.factChanges.map((change) => <div key={change} className="mt-1 text-amber-700">{change}</div>)}</div>)}</div></section>
    </div>
  </div>;
}
