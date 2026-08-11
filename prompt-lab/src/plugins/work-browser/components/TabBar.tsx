/**
 * TabBar — Tab 切换栏
 */
import { Tabs, Input, Button, Space } from '../ui';
import { X, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Tab } from '../../../core/work-browser/types';

export interface TabBarProps {
  tabs: Tab[];
  activeId?: string;
  onActivate: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
  onAdd: (url: string) => void;
}

export function TabBar({ tabs, activeId, onActivate, onClose, onAdd }: TabBarProps) {
  const [url, setUrl] = useState('');
  const items = tabs.map((t) => ({
    key: t.id,
    label: (
      <Space size={4}>
        {t.favicon && <img src={t.favicon} alt="" style={{ width: 14, height: 14 }} />}
        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.url}</span>
        <Button
          type="text"
          size="small"
          icon={<X size={12} />}
          onClick={(e) => { e.stopPropagation(); onClose(t); }}
        />
      </Space>
    ),
  }));

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-2 pt-1">
      <div className="min-w-0 flex-1 overflow-auto">
        <Tabs
          size="small"
          type="card"
          items={items}
          activeKey={activeId}
          onChange={(key) => {
            const t = tabs.find((x) => x.id === key);
            if (t) onActivate(t);
          }}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>
      <Space.Compact className="mb-1 shrink-0">
        <Input
          size="small"
          placeholder="输入 URL →"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={() => { if (url.trim()) { onAdd(url.trim()); setUrl(''); } }}
          style={{ width: 260 }}
        />
        <Button
          size="small"
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => { if (url.trim()) { onAdd(url.trim()); setUrl(''); } }}
        />
      </Space.Compact>
    </div>
  );
}
