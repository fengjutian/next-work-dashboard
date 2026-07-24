import React from 'react';
import { X } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SettingsAISites } from '@/components/settings/SettingsAISites';
import { SettingsAppearance } from '@/components/settings/SettingsAppearance';
import { SettingsShortcuts } from '@/components/settings/SettingsShortcuts';
import { SettingsDataManagement } from '@/components/settings/SettingsDataManagement';
import { SettingsAbout } from '@/components/settings/SettingsAbout';
import { SettingsAiApi } from '@/components/settings/SettingsAiApi';
import { useStore } from '@/store';

// ── Tab 配置 ──

type SettingsTab = 'ai-api' | 'ai-sites' | 'appearance' | 'shortcuts' | 'data' | 'about';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai-api', label: 'AI API' },
  { id: 'ai-sites', label: 'AI 站点' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'data', label: '数据管理' },
  { id: 'about', label: '关于' },
];

// 所有 Tab 面板（keep-alive：始终挂载，CSS 显隐）
const ALL_PANELS: { id: SettingsTab; Component: React.FC }[] = [
  { id: 'ai-api', Component: SettingsAiApi },
  { id: 'ai-sites', Component: SettingsAISites },
  { id: 'appearance', Component: SettingsAppearance },
  { id: 'shortcuts', Component: SettingsShortcuts },
  { id: 'data', Component: SettingsDataManagement },
  { id: 'about', Component: SettingsAbout },
];

// ── 侧边栏设置面板 ──

export const SettingsSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('ai-api');
  const setActiveActivity = useStore((s) => s.setActiveActivity);

  return (
    <div className="h-full flex-1 flex flex-col bg-white dark:bg-zinc-950">
      {/* 标题行 + 关闭按钮 */}
      <div className="px-3 py-2.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          设置
        </h3>
        <button
          className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          onClick={() => setActiveActivity(null)}
          title="关闭设置"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Separator />

      {/* Tab 导航栏 */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-md p-1">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-500 text-white font-medium'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
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
