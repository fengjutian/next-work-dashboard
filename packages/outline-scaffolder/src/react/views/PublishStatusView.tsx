import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../Button";

export interface DeploymentStatusView { state: "unconfigured" | "configured" | "publishing" | "published" | "failed"; message?: string; updatedAt: number; url?: string }
export interface PublishStatusViewProps {
  status: DeploymentStatusView; remoteUrl: string; branch: string; runUrl: string; checking: boolean;
  openExternal(url: string): void; refresh(): void; openPagesConfiguration(): void; openGitPublishing(): void;
}
const LABELS: Record<DeploymentStatusView["state"], string> = { unconfigured: "未配置", configured: "等待发布", publishing: "发布中", published: "构建成功", failed: "构建失败" };

export function PublishStatusView(p: PublishStatusViewProps) {
  return <div className="mx-auto max-w-3xl space-y-5"><section className="rounded-xl border border-border bg-card p-6 shadow-sm">
    <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">GitHub Pages 发布状态</h2><p className="mt-1 text-sm text-muted-foreground">读取 GitHub Actions 最近一次 Pages 构建结果。</p></div><span className={`rounded-full px-3 py-1 text-xs ${p.status.state === "published" ? "bg-emerald-500/10 text-emerald-700" : p.status.state === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{LABELS[p.status.state]}</span></div>
    <div className="mt-6 grid gap-3 rounded-lg bg-muted/40 p-4 text-sm"><div><span className="text-muted-foreground">远程仓库：</span>{p.remoteUrl || "未设置"}</div><div><span className="text-muted-foreground">分支：</span>{p.branch || "main"}</div><div><span className="text-muted-foreground">最近状态：</span>{p.status.message || "尚未生成 Pages 配置"}</div>{p.status.updatedAt > 0 && <div><span className="text-muted-foreground">更新时间：</span>{new Date(p.status.updatedAt).toLocaleString()}</div>}{p.status.url && <button type="button" className="w-fit text-primary hover:underline" onClick={() => p.openExternal(p.status.url!)}>打开发布站点：{p.status.url}</button>}{p.runUrl && <button type="button" className="w-fit text-primary hover:underline" onClick={() => p.openExternal(p.runUrl)}>查看 GitHub Actions 构建详情</button>}</div>
    <div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" disabled={!p.remoteUrl.trim() || p.checking} onClick={p.refresh}>{p.checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}刷新线上构建状态</Button><Button variant="outline" onClick={p.openPagesConfiguration}>打开 Pages 配置</Button><Button onClick={p.openGitPublishing}>打开 Git 发布</Button></div>
    <p className="mt-3 text-xs text-muted-foreground">公开仓库可直接查询；私有仓库需要 GitHub API 鉴权。</p>
  </section></div>;
}
