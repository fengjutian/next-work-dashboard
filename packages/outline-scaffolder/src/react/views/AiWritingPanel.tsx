import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "../Button";

export type AiWritingMode = "generate" | "continue" | "revise" | "polish";
export interface ResearchCandidate { id: string; title: string; source: string; snippet: string; url: string; domain: string; selected: boolean }
export interface AiWritingPanelProps {
  model: string; hasApiKey: boolean; mode: AiWritingMode; setMode(value: AiWritingMode): void;
  instruction: string; setInstruction(value: string): void; sources: string; setSources(value: string): void;
  activeFile: string; researchPlan?: string; setResearchPlan(value: string): void;
  planLoading: boolean; generatePlan(): void; researchLoading: boolean; research(): void;
  queries: string[]; researchError: string; candidates: ResearchCandidate[];
  setCandidates(updater: (current: ResearchCandidate[]) => ResearchCandidate[]): void;
  openExternal(url: string): void; addSelectedSources(): void;
  loading: boolean; stop(): void; run(write: boolean): void; error: string; result: string;
  apply(mode: "append" | "replace"): void;
}

export function AiWritingPanel(p: AiWritingPanelProps) {
  return <aside className="flex min-h-0 flex-col border-l border-border bg-card">
    <header className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />AI 章节助写</div><p className="mt-1 text-xs text-muted-foreground">当前模型：{p.model || "未配置"}</p></header>
    <div className="max-h-[52vh] space-y-3 overflow-auto border-b border-border p-4">
      <label className="block text-xs text-muted-foreground">写作任务<select value={p.mode} onChange={(event) => p.setMode(event.target.value as AiWritingMode)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="generate">生成本章正文</option><option value="continue">续写本章</option><option value="revise">按要求修改文章</option><option value="polish">润色全文</option></select></label>
      <label className="block text-xs text-muted-foreground">{p.mode === "revise" ? "具体修改要求" : "补充要求与可靠资料"}<textarea value={p.instruction} onChange={(event) => p.setInstruction(event.target.value)} className="mt-1 h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /></label>
      <label className="block text-xs text-muted-foreground">史料与参考资料<textarea value={p.sources} onChange={(event) => p.setSources(event.target.value)} placeholder="粘贴原文、论文摘要、可靠网页摘录，并注明来源。" className="mt-1 h-32 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /></label>
      <p className="text-xs text-muted-foreground">精确引文只从已提供材料取用，不伪造卷次、页码或原话。</p>
      {p.mode === "generate" && <section className="space-y-2 rounded-md border border-border p-2"><div className="flex justify-between text-xs"><b>研究提纲与证据映射</b><span className="text-muted-foreground">{p.researchPlan?.trim() ? "已生成" : "尚未生成"}</span></div><Button variant="outline" size="sm" className="w-full" disabled={p.planLoading || p.loading || !p.hasApiKey} onClick={p.generatePlan}>{p.planLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成研究提纲</Button>{p.researchPlan !== undefined && <textarea value={p.researchPlan} onChange={(event) => p.setResearchPlan(event.target.value)} disabled={p.planLoading || p.loading} className="h-52 w-full resize-y rounded-md border border-input bg-background p-2 text-xs leading-5" />}</section>}
      <Button variant="outline" className="w-full" disabled={p.researchLoading || !p.activeFile} onClick={p.research}>{p.researchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI 搜集史料</Button>
      {p.queries.length > 0 && <div className="rounded-md bg-muted/50 p-2 text-xs">{p.queries.map((query) => <div key={query} className="truncate">• {query}</div>)}</div>}
      {p.researchError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.researchError}</div>}
      {p.candidates.length > 0 && <section className="space-y-2 rounded-md border border-border p-2"><div className="flex justify-between text-xs font-medium"><span>史料来源候选</span><button type="button" className="text-primary" onClick={() => p.setCandidates((items) => items.map((item) => ({ ...item, selected: true })))}>全选</button></div><div className="max-h-56 space-y-2 overflow-auto">{p.candidates.map((item) => <label key={item.id} className="flex gap-2 rounded border p-2 text-xs"><input type="checkbox" checked={item.selected} onChange={(event) => p.setCandidates((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked } : candidate))} /><span className="min-w-0"><b className="block truncate">{item.title} · {item.source}</b><span className="line-clamp-2 text-muted-foreground">{item.snippet || "无搜索摘要"}</span><button type="button" className="text-primary" onClick={(event) => { event.preventDefault(); p.openExternal(item.url); }}>打开原文 · {item.domain}</button></span></label>)}</div><Button size="sm" className="w-full" disabled={!p.candidates.some((item) => item.selected)} onClick={p.addSelectedSources}>加入选中的史料线索</Button><p className="text-xs text-amber-700">搜索摘要不是史料原文，请打开来源核对后再引用。</p></section>}
      {!p.hasApiKey && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">尚未配置 API Key，请先前往应用设置配置 AI。</div>}
      {p.loading ? <Button variant="outline" className="w-full" onClick={p.stop}>停止生成</Button> : <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={!p.hasApiKey} onClick={() => p.run(false)}>生成预览</Button><Button disabled={!p.hasApiKey} onClick={() => p.run(true)}>生成并写入</Button></div>}
      {p.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.error}</div>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4">{p.result ? <article className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.result}</ReactMarkdown>{p.loading && <span className="inline-block h-4 w-1 animate-pulse bg-primary" />}</article> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">AI 结果将在这里预览。</div>}</div>
    <footer className={`grid gap-2 border-t border-border p-3 ${p.mode === "continue" ? "grid-cols-1" : "grid-cols-2"}`}><Button variant="outline" disabled={!p.result || p.loading} onClick={() => p.apply("append")}>{p.mode === "continue" ? "追加续写内容" : "追加到文档"}</Button>{p.mode !== "continue" && <Button disabled={!p.result || p.loading} onClick={() => p.apply("replace")}>替换文档</Button>}</footer>
  </aside>;
}
