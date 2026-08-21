import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "../Button";

export type ReviewDecision = "accepted" | "rejected" | "pending";
export interface ReviewSuggestionView { id: string; section: string; position: string; issue: string; suggestion: string; decision: ReviewDecision }
export interface ReviewPatchView { id: string; original: string; replacement: string; state: "conflict" | "applied" | string }
export interface ReviewPanelProps {
  baseUrl: string; setBaseUrl(value: string): void; model: string; setModel(value: string): void;
  apiKey: string; setApiKey(value: string): void; validApiKey: boolean; saveApiKey(): void; clearApiKey(): void;
  instruction: string; setInstruction(value: string): void; loading: boolean; hasDocument: boolean; run(): void; stop(): void;
  result: string; error: string; resultOpen: boolean; setResultOpen(value: boolean): void; activeFile: string;
  suggestions: ReviewSuggestionView[]; setSuggestions(updater: (current: ReviewSuggestionView[]) => ReviewSuggestionView[]): void;
  patches: ReviewPatchView[]; togglePatch(patch: ReviewPatchView): void; patchLoading: boolean;
  copyReport(): void; generatePatches(): void; applyReport(): void;
}

export function ReviewPanel(p: ReviewPanelProps) {
  const accepted = p.suggestions.filter((item) => item.decision === "accepted").length;
  const decide = (id: string, decision: ReviewDecision) => p.setSuggestions((current) => current.map((item) => item.id === id ? { ...item, decision } : item));
  return <aside className="flex min-h-0 flex-col border-l border-border bg-card">
    <header className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-primary" />第二模型审校报告</div><p className="mt-1 text-xs text-muted-foreground">指出错误、存疑内容和可扩写位置，不直接改动原文。</p></header>
    <div className="space-y-3 border-b border-border p-4">
      <label className="block text-xs text-muted-foreground">MiniMax 平台<select value={p.baseUrl} onChange={(event) => p.setBaseUrl(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="https://api.minimaxi.com/v1">国内站 · api.minimaxi.com</option><option value="https://api.minimax.io/v1">全球站 · api.minimax.io</option></select></label>
      <label className="block text-xs text-muted-foreground">模型<input value={p.model} onChange={(event) => p.setModel(event.target.value)} placeholder="MiniMax-M3" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
      <label className="block text-xs text-muted-foreground">API Key<input type="password" value={p.apiKey} onChange={(event) => p.setApiKey(event.target.value)} autoComplete="off" placeholder="粘贴完整 API Key" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={!p.validApiKey} onClick={p.saveApiKey}><Save className="mr-2 h-4 w-4" />加密保存</Button><Button size="sm" variant="ghost" onClick={p.clearApiKey}>清除 Key</Button></div>
      <label className="block text-xs text-muted-foreground">审校要求<textarea value={p.instruction} onChange={(event) => p.setInstruction(event.target.value)} className="mt-1 h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /></label>
      {p.loading ? <Button variant="outline" className="w-full" onClick={p.stop}>停止审校</Button> : <Button className="w-full" disabled={!p.validApiKey || !p.hasDocument} onClick={p.run}><Check className="mr-2 h-4 w-4" />分析错误与扩写空间</Button>}
      {p.result && !p.loading && <Button variant="outline" className="w-full" onClick={() => p.setResultOpen(true)}>查看分析结果</Button>}
      {p.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.error}</div>}
    </div>
    {p.resultOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) p.setResultOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="审校分析结果" className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3"><div><h2 className="font-semibold">审校分析结果</h2><p className="text-xs text-muted-foreground">{p.activeFile.split("/").pop()} · {p.suggestions.length} 条可处理意见</p></div><Button size="sm" variant="ghost" onClick={() => p.setResultOpen(false)}>关闭</Button></header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {p.suggestions.length > 0 && <section className="mb-4 space-y-2"><div className="flex justify-between text-xs font-semibold"><span>逐条处理审校意见</span><button type="button" className="text-primary" onClick={() => p.setSuggestions((items) => items.map((item) => ({ ...item, decision: "accepted" })))}>已采纳 {accepted} · 全部采纳</button></div>
            {p.suggestions.map((item) => <div key={item.id} className={`rounded-md border p-2 text-xs ${item.decision === "accepted" ? "border-emerald-500/40 bg-emerald-500/10" : item.decision === "rejected" ? "bg-muted/40 opacity-60" : "border-border"}`}><div className="font-medium">{item.section} · {item.position}</div>{item.issue && <div className="mt-1 text-muted-foreground">{item.issue}</div>}{item.suggestion && <div className="mt-1">建议：{item.suggestion}</div>}<div className="mt-2 flex gap-2">{(["accepted", "rejected", "pending"] as const).map((decision) => <button key={decision} type="button" className="text-primary hover:underline" onClick={() => decide(item.id, decision)}>{decision === "accepted" ? "采纳" : decision === "rejected" ? "拒绝" : "待定"}</button>)}</div></div>)}
          </section>}
          {p.patches.length > 0 && <section className="mb-4 space-y-3 border-t border-border pt-4"><h3 className="text-xs font-semibold">段落级修改预览</h3>{p.patches.map((patch) => <div key={patch.id} className="overflow-hidden rounded-md border border-border text-xs"><div className="bg-destructive/10 p-2"><b className="text-destructive">− 原段落</b><div className="whitespace-pre-wrap line-through">{patch.original}</div></div><div className="border-t bg-emerald-500/10 p-2"><b className="text-emerald-700">+ 修改后</b><div className="whitespace-pre-wrap">{patch.replacement}</div></div><div className="flex justify-end border-t p-2"><Button size="sm" variant={patch.state === "applied" ? "outline" : "default"} disabled={patch.state === "conflict"} onClick={() => p.togglePatch(patch)}>{patch.state === "applied" ? "撤销" : "应用此段"}</Button></div></div>)}</section>}
          {p.result ? <details className="rounded-md border border-border bg-muted/20" open={!p.suggestions.length}><summary className="cursor-pointer px-3 py-2 text-xs font-semibold">完整审校报告</summary><article className="prose prose-sm max-h-[48vh] max-w-none overflow-auto border-t p-3 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.result}</ReactMarkdown></article></details> : <div className="text-center text-xs text-muted-foreground">AI 将列出错误、待核实内容、扩写方向和修改优先级。</div>}
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-border p-3"><Button variant="outline" disabled={!p.result || p.loading} onClick={p.copyReport}>复制报告</Button><Button disabled={!accepted || p.patchLoading} onClick={p.generatePatches}>{p.patchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成段落 Diff</Button><Button variant="outline" className="col-span-2" disabled={!p.result || !accepted || p.loading || p.patchLoading} onClick={p.applyReport}>高级：按已采纳意见修改全文</Button></footer>
      </section>
    </div>}
  </aside>;
}
