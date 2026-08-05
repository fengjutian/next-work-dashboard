import React, { useCallback, useState } from 'react';
import { Code, MessageSquare, Monitor } from '@/components/icons';
import { ChatPanel } from '@/plugins/chat';

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
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-0 border-b bg-card px-2"
        role="tablist"
        aria-label="AI 对话场景"
      >
        {TABS.map((tab) => {
          const isActive = scene === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`ai-chat-scene-${tab.key}`}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => switchScene(tab.key)}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div id={`ai-chat-scene-${scene}`} role="tabpanel" className="relative flex-1 overflow-hidden">
        <ChatPanel key={scene} scene={scene} />
      </div>
    </div>
  );
};
