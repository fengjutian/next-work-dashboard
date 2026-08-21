import React from "react";
import { GitBranch, Loader2, Sparkles } from "lucide-react";
import { Button } from "../Button";

export interface GitChange { path: string; status: string }
export interface GitPanelProps {
  accentColor: string; setAccentColor(value: string): void;
  message: string; setMessage(value: string): void;
  repository: boolean | null; loading: boolean; changes: GitChange[]; error: string;
  initialize(): void; refresh(): void; commit(): void;
  remoteUrl: string; setRemoteUrl(value: string): void;
  remoteName: string; setRemoteName(value: string): void;
  branch: string; setBranch(value: string): void; publish(force?: boolean): void;
  pagesOpen: boolean; setPagesOpen(value: boolean): void;
  pagesTitle: string; setPagesTitle(value: string): void;
  pagesDescription: string; setPagesDescription(value: string): void;
  pagesAuthor: string; setPagesAuthor(value: string): void;
  pagesLanguage: string; setPagesLanguage(value: string): void;
  pagesRepositoryName: string; setPagesRepositoryName(value: string): void;
  pagesCustomDomain: string; setPagesCustomDomain(value: string): void;
  managedFilesCount: number; configurePages(): void;
  gateTargetsCount: number; gateIssues: string[]; canOverride: boolean; openGateFix(): void;
}

const Field = ({ value, onChange, placeholder }: { value: string; onChange(value: string): void; placeholder: string }) =>
  <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />;

export function GitPanel(p: GitPanelProps) {
  return <aside className="flex min-h-0 flex-col border-l border-border bg-card">
    <header className="border-b border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><GitBranch className="h-4 w-4 text-primary" />保存到 Git 仓库</div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">网站主题色
          <input type="color" value={p.accentColor} onChange={(event) => p.setAccentColor(event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
        </label>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">只提交当前文章项目，不包含仓库中的其他改动。</p>
    </header>
    <div className="max-h-[58vh] space-y-3 overflow-auto border-b border-border p-4">
      <label className="block text-xs text-muted-foreground">提交说明<Field value={p.message} onChange={p.setMessage} placeholder="docs: update manuscript" /></label>
      {p.repository === false && <Button className="w-full" disabled={p.loading} onClick={p.initialize}><GitBranch className="mr-2 h-4 w-4" />初始化为 Git 仓库</Button>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={p.loading} onClick={p.refresh}>{p.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}刷新状态</Button>
        <Button className="flex-1" disabled={p.loading || p.repository !== true || !p.changes.length || !p.message.trim()} onClick={p.commit}>本地提交 {p.changes.length}</Button>
      </div>
      <section className="space-y-2 border-t border-border pt-3">
        <div className="text-xs font-medium">推送到远程仓库</div>
        <Field value={p.remoteUrl} onChange={p.setRemoteUrl} placeholder="https://github.com/user/repo.git 或 git@..." />
        <div className="grid grid-cols-2 gap-2"><Field value={p.remoteName} onChange={p.setRemoteName} placeholder="origin" /><Field value={p.branch} onChange={p.setBranch} placeholder="main" /></div>
        <Button className="w-full" disabled={p.loading || !p.remoteUrl.trim() || !p.remoteName.trim() || !p.branch.trim()} onClick={() => p.publish()}>提交并推送到远程仓库</Button>
        <p className="text-xs text-muted-foreground">HTTPS 凭据由 Git Credential Manager 管理；SSH 地址使用系统 SSH Key。</p>
      </section>
      <section className="border-t border-border pt-3">
        <button type="button" className="flex w-full justify-between text-xs font-medium" onClick={() => p.setPagesOpen(!p.pagesOpen)}><span>GitHub Pages 配置</span><span>{p.pagesOpen ? "收起" : "展开"}</span></button>
        {p.pagesOpen && <div className="mt-3 space-y-2">
          <Field value={p.pagesTitle} onChange={p.setPagesTitle} placeholder="站点标题" />
          <textarea value={p.pagesDescription} onChange={(event) => p.setPagesDescription(event.target.value)} placeholder="站点描述（首页与 SEO）" className="h-16 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" />
          <div className="grid grid-cols-2 gap-2"><Field value={p.pagesAuthor} onChange={p.setPagesAuthor} placeholder="作者" /><Field value={p.pagesLanguage} onChange={p.setPagesLanguage} placeholder="zh-CN" /></div>
          <Field value={p.pagesRepositoryName} onChange={p.setPagesRepositoryName} placeholder="仓库名，例如 my-book" />
          <Field value={p.pagesCustomDomain} onChange={p.setPagesCustomDomain} placeholder="自定义域名（可选）" />
          <Button className="w-full" disabled={p.loading || !p.managedFilesCount} onClick={p.configurePages}>生成 GitHub Pages 配置</Button>
          {p.pagesCustomDomain.trim() && <p className="text-xs text-amber-700">还需在 GitHub Pages 设置中完成 DNS 验证。</p>}
        </div>}
      </section>
      {p.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.error}</div>}
    </div>
    {p.gateTargetsCount > 0 && <section className="space-y-2 border-b border-border p-3">
      <div className="text-xs font-medium">发现 {p.gateTargetsCount} 章质量提示</div>
      <div className="max-h-24 overflow-auto text-xs text-muted-foreground">{p.gateIssues.slice(0, 5).map((item) => <div key={item} className="truncate" title={item}>· {item}</div>)}</div>
      <div className="grid grid-cols-2 gap-2"><Button disabled={p.loading} onClick={p.openGateFix}><Sparkles className="mr-2 h-4 w-4" />处理问题</Button>
        <Button variant="outline" disabled={p.loading || !p.canOverride} onClick={() => { if (globalThis.confirm(`仍有 ${p.gateTargetsCount} 章未通过质量检查，确认忽略并提交吗？`)) p.publish(true); }}>忽略并提交</Button></div>
    </section>}
    <div className="min-h-0 flex-1 overflow-auto p-3">{p.changes.length ? p.changes.map((change) =>
      <div key={change.path} className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted"><span className="w-6 shrink-0 font-mono text-primary">{change.status.trim() || "M"}</span><span className="truncate" title={change.path}>{change.path}</span></div>)
      : !p.loading && !p.error ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">文章目录没有待提交的改动</div> : null}</div>
  </aside>;
}
