import React from "react";

const STEPS = ["填写需求", "生成目录", "修改确认", "生成文档"];

export function GeneratorProgress({ stage }: { stage: number }) {
  return <nav aria-label="文档生成进度" className="grid h-fit grid-cols-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-span-2">{STEPS.map((step, index) => { const completed = index < stage; const active = index === stage; return <div key={step} aria-current={active ? "step" : undefined} className={`relative flex min-h-16 items-center justify-center gap-3 px-4 py-3 ${index ? "border-l border-border" : ""} ${active ? "bg-primary/[0.08]" : ""}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${completed ? "border-emerald-500 bg-emerald-500 text-white" : active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground"}`}>{completed ? "✓" : index + 1}</span><span className={`text-sm ${active ? "font-semibold text-primary" : completed ? "font-medium text-foreground" : "text-muted-foreground"}`}>{step}</span>{active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</div>; })}</nav>;
}
