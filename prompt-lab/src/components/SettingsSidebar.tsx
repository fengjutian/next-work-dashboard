import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SettingsAISites } from '@/components/settings/SettingsAISites';
import { SettingsAppearance } from '@/components/settings/SettingsAppearance';
import { SettingsShortcuts } from '@/components/settings/SettingsShortcuts';
import { SettingsDataManagement } from '@/components/settings/SettingsDataManagement';
import { SettingsAbout } from '@/components/settings/SettingsAbout';

// ── Tab 配置 ──

type SettingsTab = 'ai-sites' | 'appearance' | 'shortcuts' | 'data' | 'about';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai-sites', label: 'AI 站点' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'data', label: '数据管理' },
  { id: 'about', label: '关于' },
];

// 组件注册表：新增 Tab 只需加一行
const TAB_PANELS: Record<SettingsTab, React.FC> = {
  'ai-sites': SettingsAISites,
  'appearance': SettingsAppearance,
  'shortcuts': SettingsShortcuts,
  'data': SettingsDataManagement,
  'about': SettingsAbout,
};

// ── 侧边栏设置面板 ──

export const SettingsSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('ai-sites');
  const ActivePanel = TAB_PANELS[activeTab];

  return (
    <div className="h-full flex-1 flex flex-col bg-white dark:bg-zinc-950">
      <div className="px-3 py-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          设置
        </h3>
      </div>

      <Separator />

      {/* Tab 导航栏 */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 px-2 py-1 rounded-sm text-xs transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium'
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

      {/* Tab 内容区 */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <ActivePanel />
        </div>
      </ScrollArea>
    </div>
  );
};
