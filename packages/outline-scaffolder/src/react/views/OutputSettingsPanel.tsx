import React from "react";
import { BookOpen, Check, FolderOpen, GitBranch, Loader2 } from "lucide-react";
import type { SplitMode } from "../../core/outline";
import { Button } from "../Button";

export interface OutputSettingsPanelProps {
  projectTitle: string; setProjectTitle: (value: string) => void;
  subfolder: string; setSubfolder: (value: string) => void;
  splitMode: SplitMode; setSplitMode: (value: SplitMode) => void;
  organizeByPart: boolean; setOrganizeByPart: (value: boolean) => void;
  showTemplate: boolean; toggleTemplate: () => void;
  template: string; setTemplate: (value: string) => void;
  targetPath?: string; outputIsGitRepository?: boolean;
  chooseFolder: () => void; chooseGitOutput: () => void;
  gitLoading: boolean; initializeGit: () => void;
  loadDocuments: () => void;
  checking: boolean; checkExisting: () => void;
  conflicts: string[];
}

export function OutputSettingsPanel(p: OutputSettingsPanelProps) {
  return <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h2 className="mb-3 text-sm font-semibold">输出设置</h2><div className="space-y-3">
    <label className="block text-xs text-muted-foreground">书名<input value={p.projectTitle} onChange={(event) => p.setProjectTitle(event.target.value)} placeholder="例如：秦末起义与汉王朝的建立" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
    <label className="block text-xs text-muted-foreground">子目录（可选）<input value={p.subfolder} onChange={(event) => p.setSubfolder(event.target.value)} placeholder="例如 docs" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
    <label className="block text-xs text-muted-foreground">拆分方式<select value={p.splitMode} onChange={(event) => p.setSplitMode(event.target.value as SplitMode)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"><option value="chapter">每章一个文件</option><option value="section">每节一个文件</option><option value="single">合并为单个文件</option></select></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.organizeByPart} disabled={p.splitMode === "single"} onChange={(event) => p.setOrganizeByPart(event.target.checked)} />按“篇”创建文件夹</label>
    <button type="button" className="text-left text-xs text-primary hover:underline" onClick={p.toggleTemplate}>{p.showTemplate ? "收起章节模板" : "编辑章节模板"}</button>{p.showTemplate && <><textarea value={p.template} onChange={(event) => p.setTemplate(event.target.value)} className="h-36 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs" /><p className="text-xs text-muted-foreground">变量：{"{{title}}"}、{"{{headings}}"}、{"{{placeholder}}"}</p></>}
    <Button variant="outline" className="w-full justify-start" onClick={p.chooseFolder}><FolderOpen className="mr-2 h-4 w-4" />{p.targetPath || "选择普通输出目录"}</Button><Button variant={p.outputIsGitRepository ? "secondary" : "outline"} className="w-full justify-start" onClick={p.chooseGitOutput}><GitBranch className="mr-2 h-4 w-4" />{p.outputIsGitRepository ? "已指定 Git 仓库" : "指定 Git 仓库作为输出目录"}</Button>
    {p.targetPath && p.outputIsGitRepository === true && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700">文章将直接生成到该仓库的“{p.subfolder.trim() || "根目录"}”目录中。</div>}{p.targetPath && p.outputIsGitRepository === false && <Button className="w-full" disabled={p.gitLoading} onClick={p.initializeGit}><GitBranch className="mr-2 h-4 w-4" />初始化当前目录为 Git 仓库</Button>}{p.targetPath && <Button variant="outline" className="w-full" onClick={p.loadDocuments}><BookOpen className="mr-2 h-4 w-4" />加载已有文档并保存为项目</Button>}{p.targetPath && <Button variant="secondary" className="w-full" disabled={p.checking} onClick={p.checkExisting}>{p.checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}检查文件冲突</Button>}
    {p.conflicts.length > 0 && <div className="max-h-24 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">发现 {p.conflicts.length} 个同名文件：{p.conflicts.slice(0, 3).join("、")}{p.conflicts.length > 3 ? "…" : ""}</div>}{p.targetPath && !p.checking && p.conflicts.length === 0 && <p className="text-xs text-muted-foreground">生成前会再次检查；已有文件不会被覆盖。</p>}
  </div></section>;
}
