import React from "react";
import type { EvidenceGap, NarrativeAssessment, PublicationReadiness } from "../../core/editorial-analysis";

const METRIC_LABELS: Record<string, string> = { chapters: "章节", evidenceGaps: "证据缺口", controversies: "争议卡", approvedRoles: "已签核", averageNarrativeScore: "故事性均分" };
const GAP_LABELS = { missing: "无来源", weak: "弱支持", "single-source": "单一来源", contradictory: "存在反证" } as const;

export interface DashboardViewProps {
  readiness: PublicationReadiness;
  evidenceGaps: EvidenceGap[];
  narrativeAssessments: Record<string, NarrativeAssessment>;
}

export function DashboardView(p: DashboardViewProps) {
  return <div className="mx-auto mb-5 max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">出版前总报告</h2><p className="text-xs text-muted-foreground">汇总审校阻断、证据缺口、故事性和角色签核。</p></div><div className={`text-4xl font-semibold ${p.readiness.blockers.length ? "text-amber-700" : "text-emerald-600"}`}>{p.readiness.score}</div></div><div className="mt-4 grid gap-2 sm:grid-cols-5">{Object.entries(p.readiness.metrics).map(([key, value]) => <div key={key} className="rounded bg-muted/50 p-2 text-center"><div className="text-xl font-semibold">{value}</div><div className="text-[10px] text-muted-foreground">{METRIC_LABELS[key] ?? key}</div></div>)}</div><div className="mt-3 space-y-1 text-xs">{p.readiness.blockers.map((item) => <div key={item} className="text-destructive">阻断：{item}</div>)}{p.readiness.warnings.map((item) => <div key={item} className="text-amber-700">提示：{item}</div>)}</div></section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">史料缺口地图 <span className="text-xs font-normal text-muted-foreground">{p.evidenceGaps.length} 项</span></h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.evidenceGaps.map((gap) => <div key={`${gap.claimId}-${gap.kind}`} className="rounded border border-border p-2 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{gap.chapter.split("/").pop()}</span><span className={gap.kind === "missing" || gap.kind === "contradictory" ? "text-destructive" : "text-amber-700"}>{GAP_LABELS[gap.kind]}</span></div><div className="mt-1 text-muted-foreground">{gap.claim}</div></div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">章节故事性与叙事风险</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{Object.entries(p.narrativeAssessments).map(([path, assessment]) => <div key={path} className="rounded border border-border p-2 text-xs"><div className="flex justify-between"><span className="font-medium">{path.split("/").pop()}</span><span className={assessment.score >= 70 ? "text-emerald-600" : "text-amber-700"}>{assessment.score} 分</span></div><div className="mt-1 text-muted-foreground">场景 {assessment.sceneSignals} · 行动 {assessment.actionSignals} · 冲突 {assessment.conflictSignals} · 转折 {assessment.transitionSignals} · 空泛表达 {assessment.abstractSignals}</div>{assessment.issues.slice(0, 3).map((issue) => <div key={issue.id} className="mt-1 text-amber-700">{issue.message}</div>)}</div>)}</div></section>
    </div>
  </div>;
}
