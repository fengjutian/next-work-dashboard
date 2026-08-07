import React, { useMemo, useState } from 'react';
import { Blocks, MessageSquare, Pin, Search, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';

type ResourceTab = 'prompts' | 'skills';

export const ConversationResourcesDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  boundPromptIds: string[];
  onTogglePrompt: (id: string) => void;
  boundSkillIds: string[];
  onToggleSkill: (id: string) => void;
}> = ({ open, onClose, boundPromptIds, onTogglePrompt, boundSkillIds, onToggleSkill }) => {
  const prompts = useStore((state) => state.prompts);
  const skills = useStore((state) => state.skills);
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const [tab, setTab] = useState<ResourceTab>('prompts');
  const [search, setSearch] = useState('');

  const resources = useMemo<Array<{ id: string; title: string; description: string }>>(() => {
    const query = search.trim().toLocaleLowerCase();
    if (tab === 'prompts') {
      return prompts
        .filter((prompt) => prompt.enabled !== false && (!query || [prompt.title, prompt.content, ...prompt.tags].some((value) => value.toLocaleLowerCase().includes(query))))
        .map((prompt) => ({ id: prompt.id, title: prompt.title, description: prompt.content }));
    }
    return skills
      .filter((skill) => skill.enabled && (!query || [skill.name, skill.description].some((value) => value.toLocaleLowerCase().includes(query))))
      .map((skill) => ({ id: skill.id, title: skill.name, description: skill.description }));
  }, [prompts, search, skills, tab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="flex max-h-[78vh] w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">当前对话资源</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">选择要注入当前对话的提示词和技能</p>
          </div>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}><X className="h-4 w-4" /></button>
        </header>

        <div className="flex items-center gap-1 border-b px-5 pt-3">
          {(['prompts', 'skills'] as const).map((value) => (
            <button key={value} onClick={() => { setTab(value); setSearch(''); }} className={`flex items-center gap-1.5 border-b-2 px-3 pb-2 text-xs font-medium ${tab === value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {value === 'prompts' ? <MessageSquare className="h-3.5 w-3.5" /> : <Blocks className="h-3.5 w-3.5" />}
              {value === 'prompts' ? `提示词 (${boundPromptIds.length})` : `技能 (${boundSkillIds.length})`}
            </button>
          ))}
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${tab === 'prompts' ? '提示词' : '技能'}`} className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {resources.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">暂无可用{tab === 'prompts' ? '提示词' : '技能'}</p>
          ) : (
            <div className="space-y-1.5">
              {resources.map((resource) => {
                const isPrompt = tab === 'prompts';
                const { id, title, description } = resource;
                const bound = isPrompt ? boundPromptIds.includes(id) : boundSkillIds.includes(id);
                return (
                  <button key={id} onClick={() => isPrompt ? onTogglePrompt(id) : onToggleSkill(id)} className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${bound ? 'border-primary/40 bg-primary/10' : 'border-transparent bg-background hover:border-border hover:bg-accent/50'}`}>
                    <div className={`rounded-md p-2 ${bound ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{isPrompt ? <MessageSquare className="h-4 w-4" /> : <Blocks className="h-4 w-4" />}</div>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{title}</p><p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{description}</p></div>
                    <span className={`flex items-center gap-1 text-[10px] ${bound ? 'text-primary' : 'text-muted-foreground'}`}><Pin className="h-3 w-3" />{bound ? '已加入' : '加入对话'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t bg-muted/20 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">这里只选择当前对话使用的资源</span>
          <Button variant="outline" size="sm" onClick={() => { onClose(); setActiveActivity('prompts'); }}>前往提示词与技能管理</Button>
        </footer>
      </div>
    </div>
  );
};
