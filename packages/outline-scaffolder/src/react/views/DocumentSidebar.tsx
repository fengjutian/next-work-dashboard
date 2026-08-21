import React from "react";
import { FileText, Sparkles } from "lucide-react";
import { Button } from "../Button";

interface ChapterStatus { state: string; error?: string }
interface StatusMeta { label: string; dot: string }

export interface DocumentSidebarProps {
  projectName: string;
  savedProject: boolean;
  targetPath?: string;
  managedFiles: string[];
  activeFile: string;
  dirty: boolean;
  chapterStatuses: Record<string, ChapterStatus>;
  statusMeta: Record<string, StatusMeta>;
  loadDocuments: () => void;
  saveProject: () => void;
  chooseFolder: () => void;
  batchGenerating: boolean;
  batchProgress: { completed: number; total: number; current: string };
  stopBatch: () => void;
  promptPresetId: string;
  promptPresets: Record<string, { label: string; prompt: string }>;
  selectPromptPreset: (id: string, prompt?: string) => void;
  showPromptEditor: boolean;
  togglePromptEditor: () => void;
  writingPrompt: string;
  setWritingPrompt: (value: string) => void;
  hasApiKey: boolean;
  selectedFiles: string[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  runBatch: (mode: "generate" | "rewrite" | "selected") => void;
  openDocument: (path: string) => void;
}

export function DocumentSidebar(p: DocumentSidebarProps) {
  const waiting = p.managedFiles.filter((path) => ["pending", "error"].includes(p.chapterStatuses[path]?.state ?? "pending")).length;
  return <aside className="flex min-h-0 flex-col border-r border-border bg-card">
    <div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between"><h2 className="truncate text-sm font-semibold">{p.projectName || "章节文档"}</h2><span className="text-xs text-muted-foreground">{p.managedFiles.length}</span></div>{p.savedProject && <div className="mb-1 text-xs text-emerald-600">● 已保存项目</div>}{p.targetPath ? <><button type="button" className="w-full truncate text-left text-xs text-muted-foreground hover:text-foreground" title={p.targetPath} onClick={p.loadDocuments}>{p.targetPath}</button>{!p.savedProject && p.managedFiles.length > 0 && <Button size="sm" variant="outline" className="mt-2 w-full" onClick={p.saveProject}>保存为项目</Button>}</> : <Button size="sm" variant="outline" className="w-full" onClick={p.chooseFolder}>选择目录</Button>}</div>
    {p.managedFiles.length > 0 && <div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">批量生成队列</span><span className="text-muted-foreground">待写作 {waiting}</span></div>{p.batchGenerating ? <><div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${p.batchProgress.total ? Math.round((p.batchProgress.completed / p.batchProgress.total) * 100) : 0}%` }} /></div><div className="mb-2 truncate text-xs text-muted-foreground">{p.batchProgress.completed}/{p.batchProgress.total} · {p.batchProgress.current || "正在结束"}</div><Button size="sm" variant="destructive" className="w-full" onClick={p.stopBatch}>立即终止</Button></> : <div className="space-y-2"><div className="flex gap-1"><select className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" aria-label="写作提示词预设" value={p.promptPresetId} onChange={(event) => { const id = event.target.value; p.selectPromptPreset(id, id === "custom" ? undefined : p.promptPresets[id]?.prompt); }}>{Object.entries(p.promptPresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}<option value="custom">自定义</option></select><Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={p.togglePromptEditor}>{p.showPromptEditor ? "收起" : "编辑"}</Button></div>{p.showPromptEditor && <textarea className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs" value={p.writingPrompt} onChange={(event) => p.setWritingPrompt(event.target.value)} placeholder="领域、文风和禁写要求" />}<Button size="sm" className="w-full" disabled={!p.hasApiKey || !waiting} onClick={() => p.runBatch("generate")}><Sparkles className="mr-2 h-4 w-4" />生成待写作章节</Button><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" className="px-2 text-xs" disabled={!p.hasApiKey} onClick={() => p.runBatch("rewrite")}>重写全部</Button><Button size="sm" variant="outline" className="px-2 text-xs" disabled={!p.hasApiKey || !p.selectedFiles.length} onClick={() => p.runBatch("selected")}>重写所选（{p.selectedFiles.length}）</Button></div></div>}</div>}
    <div className="min-h-0 flex-1 overflow-auto p-2">{p.managedFiles.length ? p.managedFiles.map((path) => { const status = p.chapterStatuses[path] ?? { state: "pending" }; const meta = p.statusMeta[status.state] ?? { label: status.state, dot: "bg-muted-foreground" }; return <button type="button" key={path} onClick={() => p.openDocument(path)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${p.activeFile === path ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} title={status.error || meta.label}>{!/^(?:404|readme|index|about|license|changelog)\.md$/i.test(path.split("/").pop() ?? path) && <input type="checkbox" checked={p.selectedFiles.includes(path)} aria-label={`选择 ${path}`} onClick={(event) => event.stopPropagation()} onChange={(event) => p.setSelectedFiles((items) => event.target.checked ? [...new Set([...items, path])] : items.filter((item) => item !== path))} className="h-3.5 w-3.5 shrink-0 accent-primary" />}<FileText className="h-4 w-4 shrink-0" /><span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-label={meta.label} /><span className="truncate" title={path}>{path.split("/").pop()}</span>{p.activeFile === path && p.dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" title="有未保存修改" />}</button>; }) : <div className="p-3 text-sm text-muted-foreground">生成文档或选择目录后，点击“加载已有文档”。</div>}</div>
  </aside>;
}
