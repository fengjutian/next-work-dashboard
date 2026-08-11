/**
 * WorkspaceList — 左侧 Workspace 列表
 */
import { List, Button, Tag, Typography, Space, Empty } from '../ui';
import { FolderKanban, LockKeyhole, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '../../../core/work-browser/types';

export interface WorkspaceListProps {
  workspaces: Workspace[];
  activeId?: string;
  onSelect: (ws: Workspace) => void;
  onCreate: (input: { name: string; description?: string; icon?: string }) => Promise<unknown>;
}

export function WorkspaceList({ workspaces, activeId, onSelect, onCreate }: WorkspaceListProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      setSubmitting(true);
      setCreateError('');
      await onCreate({ name: name.trim(), icon: '🌊' });
      setName(''); setCreating(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 p-3">
        <Space style={{ width: '100%' }} direction="vertical" size="small">
          <Typography.Text strong className="text-xs uppercase tracking-[0.14em] text-muted-foreground">工作区</Typography.Text>
          {!creating ? (
            <Button block icon={<Plus size={14} />} onClick={() => setCreating(true)} className="border-dashed bg-background/60">新建工作区</Button>
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
          <List
            dataSource={workspaces}
            renderItem={(ws) => {
              const active = ws.id === activeId;
              return (
                <List.Item
                  onClick={() => onSelect(ws)}
                  className={`mb-1 cursor-pointer rounded-xl border px-3 py-2.5 transition ${active ? 'border-primary/15 bg-primary-light text-primary shadow-sm' : 'border-transparent hover:bg-accent'}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/50 bg-card shadow-sm" style={{ color: ws.color || 'hsl(var(--primary))' }}><FolderKanban size={17} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm" style={{ fontWeight: active ? 600 : 500 }}>{ws.name}</div>
                      {ws.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ws.description}</Typography.Text>}
                    </div>
                    {ws.privacyMode === 'local-only' && <Tag color="orange"><LockKeyhole size={10} />本地</Tag>}
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
