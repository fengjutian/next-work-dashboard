import React, { useMemo, useState } from 'react';
import { Blocks, Globe, Search, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { SkillDetailDialog } from './SkillDetailDialog';

export const SkillManagementPanel: React.FC = () => {
  const skills = useStore((state) => state.skills);
  const toggleSkill = useStore((state) => state.toggleSkill);
  const deleteSkill = useStore((state) => state.deleteSkill);
  const importSkillFromGitHub = useStore((state) => state.importSkillFromGitHub);
  const [search, setSearch] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const { toast } = useToast();
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);

  const visibleSkills = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.source]
        .some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [search, skills]);

  const handleImport = async () => {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const skill = await importSkillFromGitHub(url);
      setImportUrl('');
      toast(`已导入技能「${skill.name}」`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '技能导入失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="space-y-2 border-b px-3 py-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleImport(); }}
              placeholder="粘贴 GitHub 仓库或技能目录 URL"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button size="sm" onClick={() => void handleImport()} disabled={importing || !importUrl.trim()}>
            {importing ? '导入中…' : '导入技能'}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索技能名称、说明或来源"
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
        <span>技能 ({visibleSkills.length})</span>
        <span>{skills.filter((skill) => skill.enabled).length} / {skills.length} 已启用</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {visibleSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
              <Blocks className="mb-3 h-10 w-10 opacity-60" />
              <p className="text-sm font-medium text-foreground">{skills.length ? '没有匹配的技能' : '暂无技能'}</p>
              <p className="mt-1 text-xs">从 GitHub 导入包含 SKILL.md 的技能</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleSkills.map((skill) => (
                <article key={skill.id} role="button" tabIndex={0} onClick={() => setSelectedSkillId(skill.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedSkillId(skill.id); }} className="group flex min-h-40 cursor-pointer flex-col rounded-lg border-2 border-border bg-card p-4 transition-all hover:border-primary hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary"><Blocks className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">{skill.name}</h3>
                      <span className="text-[10px] text-muted-foreground">{skill.files.length} 个引用文件</span>
                    </div>
                    <button
                      className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (window.confirm(`确定删除技能“${skill.name}”吗？`)) deleteSkill(skill.id);
                      }}
                      title="删除技能"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-muted-foreground">{skill.description || '暂无技能说明'}</p>
                  <p className="mt-3 truncate text-[10px] text-muted-foreground" title={skill.source}>{skill.source}</p>
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">{skill.enabled ? '已启用' : '已停用'}</span>
                    <button
                      role="switch"
                      aria-checked={skill.enabled}
                      onClick={(event) => { event.stopPropagation(); toggleSkill(skill.id); }}
                      className={`relative h-5 w-9 rounded-full transition-colors ${skill.enabled ? 'bg-primary' : 'bg-input'}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${skill.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      {selectedSkillId && selectedSkill && (
        <SkillDetailDialog
          skill={selectedSkill}
          onClose={() => setSelectedSkillId(null)}
          onToggleEnabled={() => toggleSkill(selectedSkillId)}
        />
      )}
    </div>
  );
};
