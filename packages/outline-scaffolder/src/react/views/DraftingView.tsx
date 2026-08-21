import React from "react";
import type { IndexEntry, MergeSuggestion, RewriteSuggestion } from "../../core/editorial-analysis";
import { Button } from "../Button";

interface ControversyCard { id: string; topic: string; chapter: string; positions: Array<{ label: string; argument: string; evidenceIds: string[] }>; adoptedPosition: string; rationale: string; updatedAt: number }
interface ReleaseRecord { id: string; label: "draft" | "review" | "proof" | "final"; version: string; notes: string; snapshotPath?: string; createdAt: number }

export interface DraftingViewProps {
  generateTransition: () => void;
  generateIndex: () => void;
  createBackup: () => void;
  transitionDraft: string;
  insertTransition: () => void;
  assertionSuggestions: RewriteSuggestion[];
  evidenceRewriteSuggestions: RewriteSuggestion[];
  applyRewrite: (item: RewriteSuggestion) => void;
  controversies: ControversyCard[];
  renderControversy: (card: ControversyCard) => string;
  insertControversy: (card: ControversyCard) => void;
  mergeSuggestions: MergeSuggestion[];
  bookIndex: IndexEntry[];
  releaseRecords: ReleaseRecord[];
  setReleaseRecords: React.Dispatch<React.SetStateAction<ReleaseRecord[]>>;
  finalSnapshotPath?: string;
}

export function DraftingView(p: DraftingViewProps) {
  const updateRelease = (id: string, patch: Partial<ReleaseRecord>) => p.setReleaseRecords((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  return <div className="mx-auto mb-5 max-w-7xl space-y-5">
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">智能成稿与附录</h2><p className="text-xs text-muted-foreground">把审校结论转化为受事实约束的成稿动作。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={p.generateTransition}>生成章节过渡</Button><Button size="sm" variant="outline" onClick={p.generateIndex}>生成索引与附录</Button><Button size="sm" onClick={p.createBackup}>备份项目</Button></div></div>{p.transitionDraft && <div className="mt-3 rounded border border-primary/30 bg-primary/[0.05] p-3 text-xs"><div className="font-medium">过渡段草稿</div><div className="mt-1 text-muted-foreground">{p.transitionDraft}</div><Button size="sm" className="mt-2" onClick={p.insertTransition}>插入当前章开头</Button></div>}</section>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">论断强度与证据化重写</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.assertionSuggestions.map((item) => <div key={item.id} className="rounded border border-border p-2 text-xs"><div><del className="text-red-700">{item.original}</del> → <ins className="text-emerald-700 no-underline">{item.replacement}</ins></div><div className="text-muted-foreground">{item.reason}</div><Button size="sm" variant="outline" className="mt-1" onClick={() => p.applyRewrite(item)}>应用</Button></div>)}{p.evidenceRewriteSuggestions.map((item) => <div key={item.id} className="rounded border border-amber-500/30 p-2 text-xs"><div className="text-amber-800">{item.original}</div><div className="mt-1 text-muted-foreground">{item.replacement}</div></div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">争议段落与跨章合并</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{p.controversies.map((card) => <div key={card.id} className="rounded border border-border p-2 text-xs"><div className="font-medium">{card.topic}</div><pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.renderControversy(card)}</pre><Button size="sm" variant="outline" className="mt-1" onClick={() => p.insertControversy(card)}>插入当前章</Button></div>)}{p.mergeSuggestions.map((item, index) => <div key={index} className="rounded border border-border p-2 text-xs"><div className="font-medium">{item.sourceChapter.split("/").pop()} → {item.targetChapter.split("/").pop()} · {Math.round(item.similarity * 100)}%</div><div className="text-muted-foreground">{item.recommendation}</div></div>)}</div></section>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-semibold">书后索引预览 <span className="text-xs font-normal text-muted-foreground">{p.bookIndex.length} 项</span></h3><div className="mt-3 max-h-64 space-y-1 overflow-auto">{p.bookIndex.map((item) => <div key={`${item.kind}-${item.term}`} className="grid grid-cols-[140px_80px_1fr] gap-2 rounded border border-border p-2 text-xs"><span className="font-medium">{item.term}</span><span>{item.mentions} 次</span><span className="truncate text-muted-foreground">{item.chapters.map((path) => path.split("/").pop()).join("、")}</span></div>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><div className="flex justify-between"><div><h3 className="font-semibold">版本发布标签</h3><p className="text-xs text-muted-foreground">记录草稿、送审、校样和正式版本说明。</p></div><Button size="sm" onClick={() => p.setReleaseRecords((items) => [{ id: `release-${Date.now()}`, label: "draft", version: `v${items.length + 1}`, notes: "", snapshotPath: p.finalSnapshotPath, createdAt: Date.now() }, ...items])}>新增发布</Button></div>{p.releaseRecords.map((item) => <div key={item.id} className="mt-2 grid grid-cols-[100px_100px_1fr] gap-2"><select value={item.label} onChange={(event) => updateRelease(item.id, { label: event.target.value as ReleaseRecord["label"] })} className="rounded border border-input bg-background p-1 text-xs"><option value="draft">草稿版</option><option value="review">送审版</option><option value="proof">校样版</option><option value="final">正式版</option></select><input value={item.version} onChange={(event) => updateRelease(item.id, { version: event.target.value })} className="rounded border border-input bg-background p-1 text-xs" /><input value={item.notes} onChange={(event) => updateRelease(item.id, { notes: event.target.value })} placeholder="发布说明" className="rounded border border-input bg-background p-1 text-xs" /></div>)}</section>
    </div>
  </div>;
}
