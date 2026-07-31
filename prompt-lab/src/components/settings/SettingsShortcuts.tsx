import React from 'react';

// ── 快捷键参考 Tab ──

const SHORTCUT_GROUPS = [
  {
    title: '全局快捷键',
    items: [
      { keys: 'Ctrl + Shift + Space', desc: '唤起主窗口 + 浮动搜索' },
      { keys: 'Ctrl + K', desc: '唤起浮动搜索面板' },
    ],
  },
  {
    title: '面板操作',
    items: [
      { keys: 'Ctrl + Enter', desc: '变量填充面板中快速确认' },
      { keys: '↑↓ Enter Esc', desc: '搜索面板中导航/选择/关闭' },
    ],
  },
];

export const SettingsShortcuts: React.FC = () => {
  return (
    <section>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        快捷键
      </h4>
      <div className="space-y-3">
        {SHORTCUT_GROUPS.map((group) => (
          <div
            key={group.title}
            className="border rounded-lg overflow-hidden"
          >
            <div className="px-3 py-1.5 bg-background text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              {group.title}
            </div>
            <div className="divide-y divide-border">
              {group.items.map(({ keys, desc }) => (
                <div
                  key={keys}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {desc}
                  </span>
                  <kbd className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-mono">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
