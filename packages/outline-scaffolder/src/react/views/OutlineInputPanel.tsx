import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "../Button";

interface OutlineVersion { source: string; label: string; createdAt: number }

export interface OutlineInputPanelProps {
  requirement: string;
  setRequirement: (value: string) => void;
  generating: boolean;
  generateOutline: () => void;
  error: string;
  source: string;
  setSource: (value: string) => void;
  versions: OutlineVersion[];
  saveVersion: (label?: string) => void;
}

export function OutlineInputPanel(p: OutlineInputPanelProps) {
  return <section className="flex min-h-[620px] flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
    <div><label className="mb-2 block text-sm font-semibold">第一步：写作需求</label><textarea value={p.requirement} onChange={(event) => p.setRequirement(event.target.value)} className="h-36 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="说明主题、目标读者、内容范围、时间跨度、预计章数、写作风格和必须覆盖的问题。例如：面向普通读者，系统讲述秦末到汉初的政权更替，约 25 章，兼顾制度、战争与人物选择。" /><Button className="mt-2 w-full" disabled={!p.requirement.trim() || p.generating} onClick={p.generateOutline}>{p.generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI 生成目录初稿</Button>{p.error && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.error}</div>}</div>
    <div className="flex min-h-0 flex-1 flex-col"><div className="mb-2 flex items-center justify-between"><label className="text-sm font-semibold">第二步：目录 Markdown</label><div className="flex gap-3"><button type="button" className="text-xs text-primary hover:underline" onClick={() => p.saveVersion()}>保存版本</button><button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { if (globalThis.confirm("清空当前目录吗？")) { p.saveVersion("清空前"); p.setSource(""); } }}>清空目录</button></div></div><textarea value={p.source} onChange={(event) => p.setSource(event.target.value)} spellCheck={false} className="min-h-[300px] flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="AI 生成后可继续直接编辑；也支持手动粘贴 Markdown 目录" />{p.versions.length > 0 && <div className="mt-2 rounded-md border border-border p-2"><div className="mb-1 text-xs font-medium">目录历史</div><div className="flex gap-2 overflow-x-auto">{p.versions.map((version) => <button type="button" key={`${version.createdAt}-${version.label}`} className="shrink-0 rounded bg-muted px-2 py-1 text-xs hover:bg-primary/10 hover:text-primary" title={new Date(version.createdAt).toLocaleString()} onClick={() => { p.saveVersion("恢复前"); p.setSource(version.source); }}>{version.label} · {new Date(version.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</button>)}</div></div>}<p className="mt-2 text-xs text-muted-foreground">目录仅是草稿。可直接编辑文本，也可在右侧目录树逐项修改、排序或删除。</p></div>
  </section>;
}
