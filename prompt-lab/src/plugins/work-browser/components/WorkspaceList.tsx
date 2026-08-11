/**
 * WorkspaceList — 左侧 Workspace 列表
 */
import { List, Button, Tag, Typography, Space, Empty } from 'antd';
import { Plus } from 'lucide-react';
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

  const submit = async () => {
    if (!name.trim()) return;
    await onCreate({ name: name.trim(), icon: '🌊' });
    setName(''); setCreating(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
        <Space style={{ width: '100%' }} direction="vertical" size="small">
          <Typography.Text strong>Workspace</Typography.Text>
          {!creating ? (
            <Button block icon={<Plus size={14} />} onClick={() => setCreating(true)}>新建工作区</Button>
          ) : (
            <Space.Compact style={{ width: '100%' }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') { setCreating(false); setName(''); } }}
                placeholder="名称"
                style={{ flex: 1, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 4 }}
                autoFocus
              />
              <Button type="primary" onClick={submit}>建</Button>
            </Space.Compact>
          )}
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
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
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    background: active ? '#e6f4ff' : undefined,
                    borderLeft: active ? `3px solid ${ws.color}` : '3px solid transparent',
                  }}
                >
                  <Space>
                    <span style={{ fontSize: 18 }}>{ws.icon || '🌊'}</span>
                    <div>
                      <div style={{ fontWeight: active ? 600 : 400 }}>{ws.name}</div>
                      {ws.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ws.description}</Typography.Text>}
                    </div>
                    {ws.privacyMode === 'local-only' && <Tag color="orange" style={{ marginLeft: 8 }}>本地</Tag>}
                  </Space>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
