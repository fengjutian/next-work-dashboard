import React from "react";
import { Check, GitBranch, Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "../Button";

interface StatusMeta { label: string; dot: string }
interface QualityReport { blockers: string[]; warnings: string[] }

export interface DocumentEditorHeaderProps {
  activeFile: string;
  hasTarget: boolean;
  activePanel: "git" | "ai" | "review" | "image" | null;
  togglePanel: (panel: "git" | "ai" | "review" | "image") => void;
  editorMode: "edit" | "preview";
  setEditorMode: (mode: "edit" | "preview") => void;
  dirty: boolean;
  saving: boolean;
  save: () => void;
  chapterState: string;
  statusMeta: Record<string, StatusMeta>;
  generateChapter: () => void;
  confirmDraft: () => void;
  beginReview: () => void;
  enterQuality: () => void;
  runQuality: () => void;
  qualityReport?: QualityReport;
  locateQualityIssue: () => void;
}

const STATE_GUIDANCE: Record<string, string> = {
  pending: "使用助写生成正文，或直接编辑后保存。",
  error: "使用助写生成正文，或直接编辑后保存。",
  draft: "阅读草稿并保存修改，确认后进入独立审校。",
  review: "运行审校，逐条决定哪些意见需要落实。",
  revising: "应用已采纳意见，确认修改后进入质量检查。",
  quality: "运行检查后在这里处理具体问题；通过后自动完成。",
  complete: "本章已完成；继续编辑会保留完成状态。",
  generating: "正在生成正文。",
};

export function DocumentEditorHeader(p: DocumentEditorHeaderProps) {
  const meta = p.statusMeta[p.chapterState] ?? { label: p.chapterState, dot: "bg-muted-foreground" };
  const panelButton = (panel: "git" | "ai" | "review" | "image", label: string, icon: React.ReactNode, disabled: boolean) => <Button size="sm" variant={p.activePanel === panel ? "default" : "ghost"} disabled={disabled} onClick={() => p.togglePanel(panel)}>{icon}{label}</Button>;
  return <>
    <div className="flex h-12 items-center justify-between border-b border-border px-4"><div className="min-w-0"><span className="block truncate text-sm font-medium">{p.activeFile || "未选择文档"}</span></div><div className="flex items-center gap-2">{panelButton("git", "Git", <GitBranch className="mr-2 h-4 w-4" />, !p.hasTarget)}{panelButton("ai", "助写", <Sparkles className="mr-2 h-4 w-4" />, !p.activeFile)}{panelButton("review", "审校", <Check className="mr-2 h-4 w-4" />, !p.activeFile)}{panelButton("image", "插图", <Sparkles className="mr-2 h-4 w-4" />, !p.activeFile)}<Button size="sm" variant={p.editorMode === "edit" ? "secondary" : "ghost"} onClick={() => p.setEditorMode("edit")}>编辑</Button><Button size="sm" variant={p.editorMode === "preview" ? "secondary" : "ghost"} onClick={() => p.setEditorMode("preview")}>预览</Button><Button size="sm" disabled={!p.dirty || p.saving || !p.activeFile} onClick={p.save}>{p.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}保存</Button></div></div>
    {p.activeFile && <><div className="flex items-center gap-3 border-b border-border bg-primary/[0.04] px-4 py-2.5"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} /><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{meta.label}</div><div className="truncate text-xs text-muted-foreground">{STATE_GUIDANCE[p.chapterState] ?? "正在生成正文。"}</div></div>{["pending", "error"].includes(p.chapterState) && <Button size="sm" onClick={p.generateChapter}>生成本章</Button>}{p.chapterState === "draft" && <Button size="sm" disabled={p.dirty} onClick={p.confirmDraft}>确认草稿并审校</Button>}{p.chapterState === "review" && <Button size="sm" onClick={p.beginReview}>开始审校</Button>}{p.chapterState === "revising" && (p.dirty ? <Button size="sm" disabled={p.saving} onClick={p.save}>{p.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存修改</Button> : <Button size="sm" onClick={p.enterQuality}>进入质量检查</Button>)}{p.chapterState === "quality" && <Button size="sm" disabled={p.dirty} onClick={p.runQuality}>{p.dirty ? "请先保存" : p.qualityReport?.blockers.length ? "重新检查" : "运行质量检查"}</Button>}</div>{p.chapterState === "quality" && p.qualityReport && !p.dirty && <div className={`border-b px-4 py-3 ${p.qualityReport.blockers.length ? "border-destructive/30 bg-destructive/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]"}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className={`text-xs font-semibold ${p.qualityReport.blockers.length ? "text-destructive" : "text-emerald-700"}`}>{p.qualityReport.blockers.length ? `需要处理 ${p.qualityReport.blockers.length} 项` : "质量检查已通过"}</div>{p.qualityReport.blockers.map((item) => <div key={item} className="mt-1 text-xs text-destructive">• {item}</div>)}{p.qualityReport.warnings.map((item) => <div key={item} className="mt-1 text-xs text-amber-700">提示：{item}</div>)}</div>{p.qualityReport.blockers.some((item) => item.includes("待核实") || item.includes("占位符")) && <Button size="sm" variant="outline" onClick={p.locateQualityIssue}>定位正文标记</Button>}</div></div>}</>}
  </>;
}
