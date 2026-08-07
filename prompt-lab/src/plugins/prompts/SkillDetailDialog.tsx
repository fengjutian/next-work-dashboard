import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Blocks, FileText, Globe, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { Skill } from '@/core/skill';

export const SkillDetailDialog: React.FC<{
  skill: Skill;
  onClose: () => void;
  onToggleEnabled: () => void;
}> = ({ skill, onClose, onToggleEnabled }) => {
  const [activeFile, setActiveFile] = useState<string>('SKILL.md');
  const selectedContent = activeFile === 'SKILL.md'
    ? skill.body
    : skill.files.find((file) => file.path === activeFile)?.content ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6" onClick={onClose}>
      <section className="flex h-[82vh] w-[min(1000px,92vw)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="skill-detail-title" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Blocks className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="skill-detail-title" className="truncate text-base font-semibold text-foreground">{skill.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${skill.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{skill.enabled ? '已启用' : '已停用'}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.description || '暂无技能说明'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onToggleEnabled}>{skill.enabled ? '停用技能' : '启用技能'}</Button>
          <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose} aria-label="关闭技能详情"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-60 shrink-0 overflow-y-auto border-r bg-muted/20 p-3">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">技能内容</div>
            <button type="button" onClick={() => setActiveFile('SKILL.md')} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${activeFile === 'SKILL.md' ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent'}`}>
              <FileText className="h-4 w-4" />SKILL.md
            </button>
            {skill.files.length > 0 && <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">引用文件 ({skill.files.length})</div>}
            {skill.files.map((file) => (
              <button key={file.path} type="button" onClick={() => setActiveFile(file.path)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${activeFile === file.path ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent'}`} title={file.path}>
                <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.path}</span>
              </button>
            ))}
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between gap-4 border-b pb-3">
              <div><h3 className="text-sm font-semibold text-foreground">{activeFile}</h3><p className="mt-1 text-[10px] text-muted-foreground">以下内容会作为技能指令提供给模型</p></div>
              <span className="text-[10px] text-muted-foreground">{selectedContent.length.toLocaleString()} 字符</span>
            </div>
            {selectedContent ? (
              <div className="prose prose-sm max-w-none text-foreground dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedContent}</ReactMarkdown></div>
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">该文件没有内容</div>
            )}
          </main>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t bg-muted/20 px-5 py-3 text-[10px] text-muted-foreground">
          <Globe className="h-3.5 w-3.5" /><span className="shrink-0">来源</span><span className="min-w-0 truncate" title={skill.source}>{skill.source}</span>
        </footer>
      </section>
    </div>
  );
};
