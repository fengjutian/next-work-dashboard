import React from "react";
import type { EditorialPresetId, ExportGate, HistoricalMapPoint, QualitySnapshot } from "../../core/editorial-analysis";
import { Button } from "../Button";

interface CommentThread { id: string; chapter: string; quote: string; status: "open" | "resolved"; comments: Array<{ id: string; author: string; text: string; createdAt: number }>; createdAt: number }
interface AiExecutionLog { id: string; operation: string; model: string; chapter: string; durationMs: number; inputChars: number; outputChars: number }
interface ReleaseRecord { id: string; label: "draft" | "review" | "proof" | "final"; version: string; notes: string; createdAt: number }

export interface DeliveryViewProps {
  presetId: EditorialPresetId;
  presets: Array<{ id: EditorialPresetId; label: string }>;
  setPresetId: (id: EditorialPresetId) => void;
  exportGate: ExportGate;
  aiConstraintBlock: string;
  addComment: () => void;
  exportPrintHtml: () => void;
  exportPublicationFormats: () => void;
  restoreBackup: () => void;
  commentThreads: CommentThread[];
  setCommentThreads: React.Dispatch<React.SetStateAction<CommentThread[]>>;
  openDocument: (path: string) => void;
  aiExecutionLogs: AiExecutionLog[];
  historicalMapYear?: number;
  setHistoricalMapYear: (year?: number) => void;
  historicalMapPoints: HistoricalMapPoint[];
  releaseRecords: ReleaseRecord[];
  qualitySnapshots: QualitySnapshot[];
}

export function DeliveryView(p: DeliveryViewProps) {
  const updateThread = (id: string, update: (thread: CommentThread) => CommentThread) => p.setCommentThreads((items) => items.map((item) => item.id === id ? update(item) : item));
  return <div className="mx-auto mb-5 max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">协作与交付门禁</h2><p className="text-xs text-muted-foreground">按作品类型切换证据、叙事和签核要求。</p></div><div className="flex gap-2"><select value={p.presetId} onChange={(event) => p.setPresetId(event.target.value as EditorialPresetId)} className="rounded border border-input bg-background px-2 text-xs">{p.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><Button size="sm" variant="outline" onClick={p.addComment}>为选中文字建评论</Button><Button size="sm" disabled={!p.exportGate.allowed} onClick={p.exportPrintHtml}>导出 HTML 印刷稿</Button><Button size="sm" variant="outline" onClick={p.exportPublicationFormats}>导出 DOCX / PDF / EPUB</Button><Button size="sm" variant="outline" onClick={p.restoreBackup}>备份恢复向导</Button></div></div><div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]"><div className={`rounded p-3 text-xs ${p.exportGate.allowed ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}><div className="font-medium">{p.exportGate.allowed ? "已通过交付门禁" : `尚有 ${p.exportGate.blockers.length} 项阻断`}</div>{p.exportGate.blockers.slice(0, 8).map((item) => <div key={item}>· {item}</div>)}</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-[10px]">{p.aiConstraintBlock}</pre></div></section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">段落评论线程</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.commentThreads.map((thread) => <div key={thread.id} className="rounded border border-border p-2 text-xs"><div className="flex justify-between"><button type="button" onClick={() => p.openDocument(thread.chapter)} className="truncate font-medium text-primary">{thread.chapter.split("/").pop()}：“{thread.quote.slice(0, 60)}”</button><select value={thread.status} onChange={(event) => updateThread(thread.id, (item) => ({ ...item, status: event.target.value as CommentThread["status"] }))} className="rounded border border-input bg-background p-1"><option value="open">讨论中</option><option value="resolved">已解决</option></select></div>{thread.comments.map((comment) => <div key={comment.id} className="mt-2 grid grid-cols-[90px_1fr] gap-2"><input value={comment.author} onChange={(event) => updateThread(thread.id, (item) => ({ ...item, comments: item.comments.map((entry) => entry.id === comment.id ? { ...entry, author: event.target.value } : entry) }))} placeholder="评论人" className="rounded border border-input bg-background p-1" /><input value={comment.text} onChange={(event) => updateThread(thread.id, (item) => ({ ...item, comments: item.comments.map((entry) => entry.id === comment.id ? { ...entry, text: event.target.value } : entry) }))} placeholder="输入意见" className="rounded border border-input bg-background p-1" /></div>)}<Button size="sm" variant="ghost" className="mt-1" onClick={() => updateThread(thread.id, (item) => ({ ...item, comments: [...item.comments, { id: `comment-${Date.now()}`, author: "", text: "", createdAt: Date.now() }] }))}>回复</Button></div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">AI 执行与成本记录 <span className="text-xs font-normal text-muted-foreground">{p.aiExecutionLogs.length} 次</span></h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.aiExecutionLogs.map((log) => <div key={log.id} className="grid grid-cols-[1fr_100px_90px] gap-2 rounded border border-border p-2 text-xs"><span><span className="font-medium">{log.operation}</span><span className="block truncate text-muted-foreground">{log.chapter.split("/").pop()} · {log.model}</span></span><span>{(log.durationMs / 1000).toFixed(1)} 秒</span><span>{log.inputChars.toLocaleString()} → {log.outputChars.toLocaleString()}</span></div>)}</div></section>
    </div>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">历史地理图</h3><p className="text-xs text-muted-foreground">按经纬度投影古今地名，并可按年代过滤辖属。</p></div><input type="number" value={p.historicalMapYear ?? ""} onChange={(event) => p.setHistoricalMapYear(event.target.value ? Number(event.target.value) : undefined)} placeholder="筛选年份" className="w-28 rounded border border-input bg-background p-1 text-xs" /></div><svg viewBox="0 0 720 420" className="mt-3 h-72 w-full rounded bg-muted/20">{p.historicalMapPoints.map((point) => <g key={point.id} opacity={point.active ? 1 : 0.2}><circle cx={point.x} cy={point.y} r="8" className="fill-primary stroke-background" /><text x={point.x + 12} y={point.y + 4} fontSize="12" fill="currentColor">{point.historicalName} · {point.modernName}</text></g>)}</svg>{!p.historicalMapPoints.length && <div className="py-8 text-center text-xs text-muted-foreground">请在“人物·地名·年代”中为地名补充经纬度。</div>}</section>
    <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">发布说明</h3><div className="mt-3 space-y-2">{p.releaseRecords.map((release, index) => { const previous = p.releaseRecords[index + 1]; const currentSnapshot = p.qualitySnapshots.find((item) => item.createdAt <= release.createdAt) ?? p.qualitySnapshots[0]; const previousSnapshot = previous ? p.qualitySnapshots.find((item) => item.createdAt <= previous.createdAt) : undefined; return <div key={release.id} className="rounded border border-border p-3 text-xs"><div className="font-medium">{release.version} · {release.label} · {new Date(release.createdAt).toLocaleString()}</div><div className="mt-1 text-muted-foreground">{release.notes || "未填写发布说明"}</div>{currentSnapshot && previousSnapshot && <div className="mt-1">准备度 {previousSnapshot.readiness}→{currentSnapshot.readiness}；证据覆盖 {previousSnapshot.evidenceCoverage}%→{currentSnapshot.evidenceCoverage}%；阻断 {previousSnapshot.blockers}→{currentSnapshot.blockers}</div>}</div>; })}</div></section>
  </div>;
}
