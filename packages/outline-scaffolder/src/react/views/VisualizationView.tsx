import React from "react";
import type { AnalysisIssue, ChapterHeat, EvidenceUsage, GraphEdge, GraphNode, QualityRegression, QualitySnapshot, TimelineEvent } from "../../core/editorial-analysis";
import { Button } from "../Button";

export interface VisualizationViewProps {
  generateTasks: () => void;
  loadSnapshots: () => void;
  restoreSnapshot: () => void;
  runIncrementalReview: () => void;
  affectedChapters: string[];
  relationshipGraph: { nodes: GraphNode[]; edges: GraphEdge[] };
  timelineEvents: TimelineEvent[];
  openDocument: (path: string) => void;
  evidenceReverseIndex: EvidenceUsage[];
  qualityBaselineId: string;
  setQualityBaselineId: (id: string) => void;
  qualitySnapshots: QualitySnapshot[];
  chapterHeatmap: ChapterHeat[];
  qualityRegressions: QualityRegression[];
  issues: AnalysisIssue[];
  locateIssue: (issue: AnalysisIssue) => void;
}

export function VisualizationView(p: VisualizationViewProps) {
  return <div className="mx-auto mb-5 max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">可视化与自动化工作台</h2><p className="text-xs text-muted-foreground">关系、时间、证据和质量视图，以及任务、恢复和增量回归。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={p.generateTasks}>问题批量转任务</Button><Button size="sm" variant="outline" onClick={p.loadSnapshots}>载入快照列表</Button><Button size="sm" variant="outline" onClick={p.restoreSnapshot}>恢复所选快照</Button><Button size="sm" onClick={p.runIncrementalReview}>增量回归审校</Button></div></div>{p.affectedChapters.length > 0 && <div className="mt-3 text-xs text-primary">最近受影响章节：{p.affectedChapters.map((item) => item.split("/").pop()).join("、")}</div>}</section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">人物关系图</h3><svg viewBox="0 0 720 420" className="mt-3 h-72 w-full rounded bg-muted/20">{p.relationshipGraph.edges.map((edge) => { const from = p.relationshipGraph.nodes.find((item) => item.id === edge.from); const to = p.relationshipGraph.nodes.find((item) => item.id === edge.to); if (!from || !to) return null; return <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" opacity="0.25" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2} fontSize="11" fill="currentColor">{edge.label}</text></g>; })}{p.relationshipGraph.nodes.map((node) => <g key={node.id}><circle cx={node.x} cy={node.y} r="28" className="fill-primary/15 stroke-primary" /><text x={node.x} y={node.y + 4} textAnchor="middle" fontSize="12" fill="currentColor">{node.label.slice(0, 6)}</text></g>)}</svg></section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">全书时间轴</h3><div className="mt-3 max-h-72 space-y-2 overflow-auto">{[...p.timelineEvents].sort((a, b) => (a.normalizedYear ?? 0) - (b.normalizedYear ?? 0)).map((event) => <button type="button" key={event.id} onClick={() => p.openDocument(event.chapter)} className="grid w-full grid-cols-[90px_1fr] gap-3 rounded border border-border p-2 text-left text-xs hover:bg-muted/50"><span className="font-semibold text-primary">{event.expression}</span><span><span className="font-medium">{event.chapter.split("/").pop()}</span><span className="block text-muted-foreground">{event.context}</span></span></button>)}</div></section>
    </div>
    <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">证据网络</h3><div className="mt-3 grid gap-2 md:grid-cols-3">{p.evidenceReverseIndex.slice(0, 60).map((usage) => <div key={usage.evidenceId} className="rounded border border-border p-2 text-xs"><div className="font-medium text-primary">来源：{usage.title}</div><div className="mt-1 text-muted-foreground">→ {usage.chapters.map((item) => item.split("/").pop()).join("、") || "未关联章节"}</div><div className="text-muted-foreground">→ {usage.claimIds.length} 个主张 · {usage.quotes.length} 处引文</div></div>)}</div></section>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">章节质量热力图</h3><p className="text-xs text-muted-foreground">综合阻断、证据缺口、语义重复和故事性。</p></div><select value={p.qualityBaselineId} onChange={(event) => p.setQualityBaselineId(event.target.value)} className="rounded border border-input bg-background p-1 text-xs"><option value="">选择质量基线</option>{p.qualitySnapshots.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.readiness}</option>)}</select></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{p.chapterHeatmap.map((item) => <button type="button" key={item.chapter} onClick={() => p.openDocument(item.chapter)} className={`rounded border p-3 text-left text-xs ${item.level === "blocked" ? "border-red-500/40 bg-red-500/15" : item.level === "risk" ? "border-orange-500/40 bg-orange-500/15" : item.level === "watch" ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}><div className="truncate font-medium">{item.chapter.split("/").pop()}</div><div className="mt-1 text-2xl font-semibold">{item.score}</div><div className="text-muted-foreground">阻断 {item.blockers} · 缺口 {item.gaps} · 重复 {item.duplicates}</div></button>)}</div>{p.qualityRegressions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{p.qualityRegressions.map((item) => <span key={item.metric} className={`rounded px-2 py-1 text-xs ${item.regressed ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700"}`}>{item.metric}：{item.before} → {item.after}（{item.delta > 0 ? "+" : ""}{item.delta}）</span>)}</div>}</section>
    <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">高级问题快速定位</h3><div className="mt-3 max-h-72 space-y-2 overflow-auto">{p.issues.slice(0, 100).map((issue) => <div key={issue.id} className="flex items-center justify-between gap-3 rounded border border-border p-2 text-xs"><div className="min-w-0"><div className="truncate font-medium">{issue.message}</div><div className="text-muted-foreground">{issue.chapters.map((item) => item.split("/").pop()).join("、")}</div></div><Button size="sm" variant="outline" disabled={!issue.chapters.length} onClick={() => p.locateIssue(issue)}>定位</Button></div>)}</div></section>
  </div>;
}
