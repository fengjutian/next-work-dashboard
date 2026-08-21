import React from "react";
import { Button } from "../Button";

export interface QualityReportView { score: number; blockers: string[]; warnings: string[] }
export interface QualityViewProps {
  consistencyIssues: string[];
  reports: Record<string, QualityReportView>;
  onPass(path: string): void;
}

export function QualityView({ consistencyIssues, reports, onPass }: QualityViewProps) {
  return <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2">
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex justify-between"><div><h2 className="font-semibold">全书一致性检查</h2><p className="text-xs text-muted-foreground">检查跨章重复和知识库标准写法。</p></div><span className="text-sm text-muted-foreground">{consistencyIssues.length} 项</span></div>
      {consistencyIssues.length ? <div className="max-h-[560px] space-y-2 overflow-auto">{consistencyIssues.map((issue) => <div key={issue} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-800">{issue}</div>)}</div> : <div className="py-16 text-center text-sm text-muted-foreground">运行全书检查后显示结果</div>}
    </section>
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3"><h2 className="font-semibold">章节质量门禁</h2><p className="text-xs text-muted-foreground">占位符、字数不足、待核实和必用史料缺失会阻止完成。</p></div>
      <div className="max-h-[560px] space-y-2 overflow-auto">{Object.entries(reports).map(([path, report]) => <div key={path} className="rounded-md border border-border p-3"><div className="flex justify-between"><span className="truncate text-sm font-medium" title={path}>{path.split("/").pop()}</span><span className={report.blockers.length ? "text-sm text-destructive" : "text-sm text-emerald-600"}>{report.score} 分</span></div>{report.blockers.map((item) => <div key={item} className="mt-1 text-xs text-destructive">阻断：{item}</div>)}{report.warnings.map((item) => <div key={item} className="mt-1 text-xs text-amber-700">提示：{item}</div>)}{!report.blockers.length && <Button size="sm" variant="outline" className="mt-2" onClick={() => onPass(path)}>标记为已完成</Button>}</div>)}</div>
    </section>
  </div>;
}
