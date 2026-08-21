import React from "react";
import { BookOpen } from "lucide-react";
import { Button } from "../Button";

type AppView = "generator" | "documents" | "management";
interface SavedProject { id: string; name: string; rootPath: string; subfolder?: string; files: string[] }

export interface AppNavigationProps {
  view: AppView;
  switchView: (view: AppView) => void;
  activeProject: SavedProject | null;
  managedFileCount: number;
  documentCount: number;
  projectListOpen: boolean;
  setProjectListOpen: (open: boolean) => void;
  recentProjects: SavedProject[];
  openProject: (id: string) => void;
  removeProject: (id: string) => void;
}

export function AppNavigation(p: AppNavigationProps) {
  return <><header className="flex items-center justify-between border-b border-border px-6 py-4"><div><h1 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5" />章节文档生成器</h1><p className="mt-1 text-sm text-muted-foreground">描述需求，生成并调整目录，再批量创建 Markdown 文档。</p></div><div className="flex items-center gap-2">{p.activeProject && <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700" title={p.activeProject.rootPath}>项目已保存</div>}<Button size="sm" variant="ghost" onClick={() => p.setProjectListOpen(true)}>项目目录</Button><Button size="sm" variant={p.view === "generator" ? "default" : "ghost"} onClick={() => p.switchView("generator")}>生成器</Button><Button size="sm" variant={p.view === "documents" ? "default" : "ghost"} onClick={() => p.switchView("documents")}>文档工作区</Button><Button size="sm" variant={p.view === "management" ? "default" : "ghost"} disabled={!p.managedFileCount} onClick={() => p.switchView("management")}>全书管理</Button><div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{p.documentCount} 个文档</div></div></header>
    {p.projectListOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) p.setProjectListOpen(false); }}><section role="dialog" aria-modal="true" aria-label="项目目录" className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"><div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold">项目目录</h2><p className="text-xs text-muted-foreground">{p.recentProjects.length} 个项目</p></div><Button size="sm" variant="ghost" onClick={() => p.setProjectListOpen(false)}>关闭</Button></div><div className="min-h-0 overflow-auto p-2">{p.recentProjects.length ? p.recentProjects.map((project) => <div key={project.id} className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 ${p.activeProject?.id === project.id ? "bg-primary/10" : "hover:bg-muted"}`}><BookOpen className="h-4 w-4 shrink-0 text-primary" /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { p.setProjectListOpen(false); p.openProject(project.id); }}><span className="block truncate text-sm font-medium">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{project.rootPath}{project.subfolder ? ` / ${project.subfolder}` : ""} · {project.files.length} 个文档</span></button>{p.activeProject?.id === project.id && <span className="text-[10px] text-emerald-700">当前</span>}<Button size="sm" variant="ghost" className="px-2 text-xs" onClick={() => { if (globalThis.confirm(`从目录移除“${project.name}”？不会删除文件。`)) p.removeProject(project.id); }}>移除</Button></div>) : <div className="py-12 text-center text-sm text-muted-foreground">暂无项目记录</div>}</div></section></div>}
  </>;
}
