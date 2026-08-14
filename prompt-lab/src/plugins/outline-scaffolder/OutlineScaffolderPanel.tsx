import React, { useEffect, useMemo, useState } from 'react';
import { notification } from 'antd';
import { BookOpen, Check, FileText, FolderOpen, Loader2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createChapterDocuments, createReadme, parseOutline, type OutlineNode, type SplitMode } from './outline';

const EXAMPLE = `# 第一篇 基础知识
## 第一章 产品介绍
### 1.1 产品背景
### 1.2 核心能力
## 第二章 快速开始
### 2.1 环境准备
### 2.2 安装与配置`;

const DEFAULT_TEMPLATE = `# {{title}}

{{placeholder}}

{{headings}}`;

function OutlineTree({ nodes }: { nodes: OutlineNode[] }) {
  return <ul className="space-y-1">
    {nodes.map((node) => <li key={node.id}>
      <div className="flex items-center gap-2 rounded px-2 py-1 text-sm text-foreground hover:bg-muted/60">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.title}</span>
      </div>
      {node.children.length > 0 && <div className="ml-5 border-l border-border pl-2"><OutlineTree nodes={node.children} /></div>}
    </li>)}
  </ul>;
}

export const OutlineScaffolderPanel: React.FC = () => {
  const [notice, holder] = notification.useNotification();
  const [source, setSource] = useState(EXAMPLE);
  const [projectTitle, setProjectTitle] = useState('我的文档');
  const [subfolder, setSubfolder] = useState('我的文档');
  const [splitMode, setSplitMode] = useState<SplitMode>('chapter');
  const [organizeByPart, setOrganizeByPart] = useState(true);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showTemplate, setShowTemplate] = useState(false);
  const [target, setTarget] = useState<{ path: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const nodes = useMemo(() => parseOutline(source), [source]);
  const documents = useMemo(() => createChapterDocuments(nodes, { folder: subfolder, splitMode, organizeByPart, projectTitle, template }), [nodes, organizeByPart, projectTitle, splitMode, subfolder, template]);
  const files = useMemo(() => [...documents, createReadme(documents, projectTitle, subfolder)], [documents, projectTitle, subfolder]);

  useEffect(() => { setConflicts([]); }, [files, target]);

  const chooseFolder = async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (folder) setTarget(folder);
  };

  const checkExisting = async (): Promise<string[]> => {
    if (!target) return [];
    setChecking(true);
    try {
      const byDirectory = new Map<string, Set<string>>();
      for (const file of files) {
        const parts = file.path.split('/');
        const name = parts.pop()!;
        const directory = parts.join('/');
        if (!byDirectory.has(directory)) byDirectory.set(directory, new Set());
        byDirectory.get(directory)!.add(name);
      }
      const found: string[] = [];
      for (const [directory, names] of byDirectory) {
        const result = await window.electronAPI.workspace.listDirectory(target.path, directory);
        if (!result.success) continue;
        for (const entry of result.data ?? []) if (entry.type === 'file' && names.has(entry.name)) found.push(directory ? `${directory}/${entry.name}` : entry.name);
      }
      setConflicts(found);
      return found;
    } finally { setChecking(false); }
  };

  const ensureDirectories = async () => {
    if (!target) return;
    const directories = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/'); parts.pop();
      let current = '';
      for (const part of parts) { current = current ? `${current}/${part}` : part; directories.add(current); }
    }
    for (const directory of directories) {
      const result = await window.electronAPI.workspace.createDirectory(target.path, directory);
      if (!result.success && !/EEXIST|ALREADY_EXISTS/.test(String(result.error))) throw new Error(result.error);
    }
  };

  const generate = async () => {
    if (!target || documents.length === 0) return;
    setCreating(true);
    try {
      const existing = await checkExisting();
      if (existing.length) throw new Error(`ALREADY_EXISTS:${existing[0]}`);
      await ensureDirectories();
      for (let index = 0; index < files.length; index += 200) {
        const result = await window.electronAPI.workspace.mutateFiles(target.path, files.slice(index, index + 200).map((file) => ({
          kind: 'create' as const, path: file.path, content: file.content, encoding: 'utf8' as const, lineEnding: 'LF' as const,
        })));
        if (!result.success) throw new Error(result.error);
      }
      notice.success({ message: '文档骨架创建完成', description: `已创建 ${documents.length} 个章节文档和 README.md。`, placement: 'bottomRight' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notice.error({ message: '创建失败', description: message.includes('ALREADY_EXISTS') ? '目标中已有同名文件。为保护原内容，本次没有覆盖，请更换子目录名称。' : message, placement: 'bottomRight' });
    } finally { setCreating(false); }
  };

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    {holder}
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div><h1 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5" />章节文档生成器</h1><p className="mt-1 text-sm text-muted-foreground">粘贴目录，批量创建可自行填写的 Markdown 文档。</p></div>
      <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{documents.length} 个文档</div>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-auto p-6 lg:grid-cols-[minmax(380px,1.15fr)_minmax(300px,.85fr)]">
      <section className="flex min-h-[520px] flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <label className="mb-2 text-sm font-medium">章节目录</label>
        <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} className="min-h-[420px] flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="支持 Markdown 标题、第一章/第一节和数字编号目录" />
        <p className="mt-2 text-xs text-muted-foreground">默认按“章”创建文件，其下小节成为文档内标题。</p>
      </section>
      <div className="flex min-h-0 flex-col gap-5">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">输出设置</h2>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">文档名称<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block text-xs text-muted-foreground">子目录（可选）<input value={subfolder} onChange={(event) => setSubfolder(event.target.value)} placeholder="例如 docs" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block text-xs text-muted-foreground">拆分方式<select value={splitMode} onChange={(event) => setSplitMode(event.target.value as SplitMode)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"><option value="chapter">每章一个文件</option><option value="section">每节一个文件</option><option value="single">合并为单个文件</option></select></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={organizeByPart} disabled={splitMode === 'single'} onChange={(event) => setOrganizeByPart(event.target.checked)} />按“篇”创建文件夹</label>
            <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => setShowTemplate((value) => !value)}>{showTemplate ? '收起章节模板' : '编辑章节模板'}</button>
            {showTemplate && <><textarea value={template} onChange={(event) => setTemplate(event.target.value)} className="h-36 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs" /><p className="text-xs text-muted-foreground">变量：{'{{title}}'}、{'{{headings}}'}、{'{{placeholder}}'}</p></>}
            <Button variant="outline" className="w-full justify-start" onClick={chooseFolder}><FolderOpen className="mr-2 h-4 w-4" />{target ? target.path : '选择输出目录'}</Button>
            {target && <Button variant="secondary" className="w-full" disabled={checking} onClick={checkExisting}>{checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}检查文件冲突</Button>}
            {conflicts.length > 0 && <div className="max-h-24 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">发现 {conflicts.length} 个同名文件：{conflicts.slice(0, 3).join('、')}{conflicts.length > 3 ? '…' : ''}</div>}
            {target && !checking && conflicts.length === 0 && <p className="text-xs text-muted-foreground">生成前会再次检查；已有文件不会被覆盖。</p>}
          </div>
        </section>
        <section className="min-h-[230px] flex-1 overflow-auto rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">目录预览</h2>{nodes.length > 0 && <Check className="h-4 w-4 text-emerald-500" />}</div>
          {nodes.length ? <OutlineTree nodes={nodes} /> : <p className="text-sm text-muted-foreground">输入目录后在这里预览层级。</p>}
        </section>
        <Button size="lg" disabled={!target || documents.length === 0 || creating} onClick={generate}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}生成 {documents.length || 0} 个章节文档</Button>
      </div>
    </div>
  </div>;
};
