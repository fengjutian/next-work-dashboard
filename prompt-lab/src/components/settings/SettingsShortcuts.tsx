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
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        快捷键
      </h4>
      <div className="space-y-3">
        {SHORTCUT_GROUPS.map((group) => (
          <div
            key={group.title}
            className="border rounded-lg overflow-hidden"
          >
            <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
              {group.title}
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.items.map(({ keys, desc }) => (
                <div
                  key={keys}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {desc}
                  </span>
                  <kbd className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 font-mono">
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
