import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SettingsAISites } from '@/components/settings/SettingsAISites';
import { SettingsAppearance } from '@/components/settings/SettingsAppearance';
import { SettingsShortcuts } from '@/components/settings/SettingsShortcuts';
import { SettingsDataManagement } from '@/components/settings/SettingsDataManagement';
import { SettingsAbout } from '@/components/settings/SettingsAbout';
import { SettingsAiApi } from '@/components/settings/SettingsAiApi';
import { SettingsMemory } from '@/components/settings/SettingsMemory';
import { SettingsPlugins } from '@/components/settings/SettingsPlugins';

// ── Tab 配置 ──

type SettingsTab = 'ai-api' | 'memory' | 'ai-sites' | 'plugins' | 'appearance' | 'shortcuts' | 'data' | 'about';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai-api', label: 'AI API' },
  { id: 'memory', label: '知识库' },
  { id: 'ai-sites', label: 'AI 站点' },
  { id: 'plugins', label: '插件' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'data', label: '数据管理' },
  { id: 'about', label: '关于' },
];

// 所有 Tab 面板（keep-alive：始终挂载，CSS 显隐）
const ALL_PANELS: { id: SettingsTab; Component: React.FC }[] = [
  { id: 'ai-api', Component: SettingsAiApi },
  { id: 'memory', Component: SettingsMemory },
  { id: 'ai-sites', Component: SettingsAISites },
  { id: 'plugins', Component: SettingsPlugins },
  { id: 'appearance', Component: SettingsAppearance },
  { id: 'shortcuts', Component: SettingsShortcuts },
  { id: 'data', Component: SettingsDataManagement },
  { id: 'about', Component: SettingsAbout },
];

// ── 侧边栏设置面板 ──

export const SettingsSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('ai-api');

  return (
    <div className="h-full flex-1 flex flex-col bg-card">
      {/* Tab 导航栏 */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1 bg-muted rounded-md p-1">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary text-white font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Tab 内容区 — keep-alive：全部面板常驻，CSS 显隐保留滚动位置 */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {ALL_PANELS.map(({ id, Component }) => (
            <div
              key={id}
              style={{ display: activeTab === id ? 'block' : 'none' }}
            >
              <Component />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
