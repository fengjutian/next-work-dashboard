/**
 * WorkspaceList — 左侧 Workspace 列表
 */
import { Button, Tag, Typography, Space, Empty } from '../ui';
import { Check, FolderKanban, LockKeyhole, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '../../../core/work-browser/types';

export interface WorkspaceListProps {
  workspaces: Workspace[];
  activeId?: string;
  onSelect: (ws: Workspace) => void;
  onCreate: (input: { name: string; description?: string; icon?: string; color?: string }) => Promise<unknown>;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<unknown>;
}

const WORKSPACE_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#4f46e5'];

export function WorkspaceList({ workspaces, activeId, onSelect, onCreate, onUpdate }: WorkspaceListProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      setSubmitting(true);
      setCreateError('');
      await onCreate({ name: name.trim(), icon: '🌊', color: WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length] });
      setName(''); setCreating(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (workspace: Workspace, color: string) => {
    setEditingId(workspace.id);
    setEditingName(workspace.name);
    setEditingColor(color);
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    await onUpdate(editingId, { name: editingName.trim(), color: editingColor });
    setEditingId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/30 p-3">
        <Space style={{ width: '100%' }} direction="vertical" size="small">
          <Typography.Text strong className="text-xs uppercase tracking-[0.14em] text-muted-foreground">工作区</Typography.Text>
          {!creating ? (
            <Button block icon={<Plus size={14} />} onClick={() => setCreating(true)} className="border-border/40 bg-background/30 shadow-none">新建工作区</Button>
          ) : (
            <div className="space-y-1.5">
            <Space.Compact style={{ width: '100%' }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') { setCreating(false); setName(''); } }}
                placeholder="名称"
                className="h-9 min-w-0 flex-1 rounded-l-lg border border-input bg-card px-2 text-sm outline-none focus:border-primary/40"
                autoFocus
              />
              <Button type="primary" loading={submitting} disabled={submitting || !name.trim()} onClick={submit}>建</Button>
            </Space.Compact>
            {createError && <p className="text-[10px] text-destructive">{createError}</p>}
            </div>
          )}
        </Space>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {workspaces.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有工作区" style={{ marginTop: 24 }} />
        ) : (
          <div className="space-y-1.5">
            {workspaces.map((ws, index) => {
              const active = ws.id === activeId;
              const color = ws.color && ws.color.toLowerCase() !== '#2563eb'
                ? ws.color
                : WORKSPACE_COLORS[index % WORKSPACE_COLORS.length];
              const editing = editingId === ws.id;
              return (
                <div
                  key={ws.id}
                  onClick={() => onSelect(ws)}
                  onDoubleClick={() => beginEdit(ws, color)}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border px-2.5 py-2.5 transition hover:-translate-y-px hover:shadow-sm"
                  style={{ borderColor: active ? `${color}55` : 'transparent', backgroundColor: active ? `${color}12` : undefined }}
                >
                  <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: color, opacity: active ? 1 : 0.45 }} />
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color, backgroundColor: `${color}16` }}><FolderKanban size={17} /></span>
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') setEditingId(null); }}
                          className="h-7 w-full rounded-md border border-border/60 bg-card px-2 text-sm outline-none focus:border-primary/40"
                          autoFocus
                        />
                      ) : <div className="truncate text-sm" style={{ fontWeight: active ? 650 : 500, color: active ? color : undefined }}>{ws.name}</div>}
                      {ws.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ws.description}</Typography.Text>}
                    </div>
                    {ws.privacyMode === 'local-only' && <Tag color="orange"><LockKeyhole size={10} />本地</Tag>}
                    {!editing && <button type="button" aria-label="修改工作区" onClick={(event) => { event.stopPropagation(); beginEdit(ws, color); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-muted group-hover:opacity-100"><Pencil size={12} /></button>}
                  </div>
                  {editing && (
                    <div className="mt-2 flex items-center gap-1.5 pl-11" onClick={(event) => event.stopPropagation()}>
                      {WORKSPACE_COLORS.map((choice) => <button key={choice} type="button" aria-label={`选择颜色 ${choice}`} onClick={() => setEditingColor(choice)} className="grid h-5 w-5 place-items-center rounded-full" style={{ backgroundColor: choice }}>{editingColor === choice && <Check size={11} className="text-white" />}</button>)}
                      <button type="button" onClick={() => void saveEdit()} className="ml-auto grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground"><Check size={12} /></button>
                      <button type="button" onClick={() => setEditingId(null)} className="grid h-6 w-6 place-items-center rounded-md bg-muted text-muted-foreground"><X size={12} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
