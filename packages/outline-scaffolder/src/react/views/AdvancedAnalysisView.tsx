import React from "react";
import { Check, Loader2 } from "lucide-react";
import type { AnalysisIssue, ProfessionalRulePackId, SemanticDuplicate, TimelineEvent } from "../../core/editorial-analysis";
import { Button } from "../Button";

const RULE_PACKS: Array<[ProfessionalRulePackId, string]> = [
  ["history", "历史"], ["law", "法律"], ["medicine", "医学"],
  ["finance", "财经"], ["technology", "计算机"], ["general", "通用语言"],
];

export interface AdvancedAnalysisViewProps {
  loading: boolean;
  canRun: boolean;
  rulePacks: ProfessionalRulePackId[];
  setRulePacks: React.Dispatch<React.SetStateAction<ProfessionalRulePackId[]>>;
  timelineEvents: TimelineEvent[];
  issues: AnalysisIssue[];
  duplicates: SemanticDuplicate[];
  run: () => void;
}

export function AdvancedAnalysisView(p: AdvancedAnalysisViewProps) {
  return <div className="mx-auto max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">全书时间线、实体与语义分析</h2><p className="text-xs text-muted-foreground">扫描全部章节，检查年代冲突、知识库规范写法、专业规则和跨章近似段落。</p></div>
        <Button disabled={p.loading || !p.canRun} onClick={p.run}>{p.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}运行高级分析</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{RULE_PACKS.map(([pack, label]) => <label key={pack} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-xs ${p.rulePacks.includes(pack) ? "border-primary bg-primary/10 text-primary" : "border-border"}`}><input type="checkbox" checked={p.rulePacks.includes(pack)} onChange={() => p.setRulePacks((current) => current.includes(pack) ? current.filter((item) => item !== pack) : [...current, pack])} />{label}</label>)}</div>
    </section>
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">时间线 <span className="text-xs font-normal text-muted-foreground">{p.timelineEvents.length} 条</span></h3><div className="mt-3 max-h-96 space-y-2 overflow-auto">{[...p.timelineEvents].sort((a, b) => (a.normalizedYear ?? 0) - (b.normalizedYear ?? 0)).map((event) => <div key={event.id} className="rounded border border-border p-2 text-xs"><div className="font-medium">{event.expression} · {event.chapter.split("/").pop()}</div><div className="mt-1 text-muted-foreground">{event.context}</div></div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">冲突与专业问题 <span className="text-xs font-normal text-muted-foreground">{p.issues.length} 项</span></h3><div className="mt-3 max-h-96 space-y-2 overflow-auto">{p.issues.map((issue) => <div key={issue.id} className={`rounded border p-2 text-xs ${issue.severity === "blocker" ? "border-destructive/40" : "border-amber-500/30"}`}><div className="font-medium">{issue.message}</div><div className="mt-1 text-muted-foreground">{issue.chapters.map((item) => item.split("/").pop()).join("、")}</div>{issue.excerpts.slice(0, 2).map((excerpt) => <div key={excerpt} className="mt-1 rounded bg-muted/50 p-1">{excerpt}</div>)}</div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">跨章语义重复 <span className="text-xs font-normal text-muted-foreground">{p.duplicates.length} 组</span></h3><div className="mt-3 max-h-96 space-y-2 overflow-auto">{p.duplicates.map((duplicate, index) => <div key={`${duplicate.leftChapter}-${duplicate.rightChapter}-${index}`} className="rounded border border-border p-2 text-xs"><div className="font-medium">相似度 {Math.round(duplicate.similarity * 100)}% · {duplicate.leftChapter.split("/").pop()} ↔ {duplicate.rightChapter.split("/").pop()}</div><div className="mt-1 line-clamp-2 text-muted-foreground">{duplicate.leftText}</div><div className="mt-1 line-clamp-2 text-muted-foreground">{duplicate.rightText}</div></div>)}</div></section>
    </div>
  </div>;
}
