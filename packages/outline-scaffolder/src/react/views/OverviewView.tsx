import React from "react";

interface ChapterStatus {
  state: string;
}

interface QualityReport {
  wordCount: number;
  score: number;
  blockers: string[];
}

interface EvidenceRecord {
  chapter: string;
  status: string;
}

export interface OverviewViewProps {
  managedFiles: string[];
  chapterStatuses: Record<string, ChapterStatus>;
  qualityReports: Record<string, QualityReport>;
  evidenceRecords: EvidenceRecord[];
  statusLabels: Record<string, string>;
  openDocument: (path: string) => void;
}

export function OverviewView(props: OverviewViewProps) {
  const chapters = props.managedFiles.filter((path) => !/README\.md$/i.test(path));
  const statuses = Object.values(props.chapterStatuses);
  const reports = Object.values(props.qualityReports);
  const cards: Array<[string, number, string]> = [
    ["章节总数", chapters.length, "text-foreground"],
    ["已完成", statuses.filter((item) => item.state === "complete").length, "text-emerald-600"],
    ["待确认", statuses.filter((item) => item.state === "draft").length, "text-sky-600"],
    ["待审校", statuses.filter((item) => item.state === "review").length, "text-amber-600"],
    ["质量阻断", reports.filter((item) => item.blockers.length > 0).length, "text-destructive"],
    ["已核实史料", props.evidenceRecords.filter((item) => item.status === "verified").length, "text-primary"],
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-2 text-3xl font-semibold ${color}`}>{value}</div>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div><h2 className="font-semibold">章节生产计划</h2><p className="text-xs text-muted-foreground">状态、字数、史料和质量结果集中查看</p></div>
          <span className="text-sm text-muted-foreground">总计 {reports.reduce((sum, item) => sum + item.wordCount, 0).toLocaleString()} 字</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2">章节</th><th className="px-4 py-2">状态</th><th className="px-4 py-2">字数</th><th className="px-4 py-2">史料</th><th className="px-4 py-2">质量</th><th className="px-4 py-2">操作</th></tr></thead>
            <tbody>
              {chapters.map((path) => {
                const report = props.qualityReports[path];
                const status = props.chapterStatuses[path]?.state ?? "pending";
                const evidenceCount = props.evidenceRecords.filter((item) => item.chapter === path).length;
                return <tr key={path} className="border-t border-border">
                  <td className="max-w-[420px] truncate px-4 py-3 font-medium" title={path}>{path.split("/").pop()}</td>
                  <td className="px-4 py-3">{props.statusLabels[status] ?? status}</td>
                  <td className="px-4 py-3">{report?.wordCount ?? "—"}</td>
                  <td className="px-4 py-3">{evidenceCount}</td>
                  <td className="px-4 py-3"><span className={report ? report.blockers.length ? "text-destructive" : "text-emerald-600" : "text-muted-foreground"}>{report ? `${report.score} 分${report.blockers.length ? ` · ${report.blockers.length} 阻断` : ""}` : "未检查"}</span></td>
                  <td className="px-4 py-3"><button type="button" className="text-primary hover:underline" onClick={() => props.openDocument(path)}>打开</button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
