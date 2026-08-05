import React, { useState, useCallback } from 'react';
import { MessageSquare, Code, Monitor } from '@/components/icons';
import { ChatPanel } from '@/plugins/chat';
import { CodeEditorPanel } from '@/plugins/code-editor';
import { Workbench } from './Workbench';

type Scene = 'chat' | 'code' | 'workbench';

interface TabDef {
  key: Scene;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const TABS: TabDef[] = [
  { key: 'chat', label: '对话', icon: MessageSquare },
  { key: 'code', label: '代码编程', icon: Code },
  { key: 'workbench', label: '工作台', icon: Monitor },
];

export const AIChatModule: React.FC = () => {
  const [scene, setScene] = useState<Scene>('chat');

  const switchScene = useCallback((key: Scene) => setScene(key), []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab 栏 */}
      <div className="flex items-center gap-0 border-b shrink-0 bg-card px-2">
        {TABS.map((tab) => {
          const isActive = scene === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
              onClick={() => switchScene(tab.key)}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 三个场景始终挂载，仅显示活跃的 */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0" style={{ display: scene === 'chat' ? undefined : 'none' }}>
          <ChatPanel />
        </div>
        <div className="absolute inset-0" style={{ display: scene === 'code' ? undefined : 'none' }}>
          <CodeEditorPanel />
        </div>
        <div className="absolute inset-0" style={{ display: scene === 'workbench' ? undefined : 'none' }}>
          <Workbench />
        </div>
      </div>
    </div>
  );
};
