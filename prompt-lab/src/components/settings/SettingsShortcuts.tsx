import React from 'react';

// ── 快捷键参考 Tab ──

const SHORTCUTS = [
  { keys: 'Ctrl + Shift + Space', desc: '唤起主窗口 + 浮动搜索' },
  { keys: 'Ctrl + K', desc: '唤起浮动搜索面板' },
  { keys: 'Ctrl + Enter', desc: '变量填充面板中快速确认' },
  { keys: '↑↓ Enter Esc', desc: '搜索面板中导航/选择/关闭' },
];

export const SettingsShortcuts: React.FC = () => {
  return (
    <section>
      <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
        快捷键
      </h4>
      <div className="space-y-1.5 text-xs">
        {SHORTCUTS.map(({ keys, desc }) => (
          <div key={keys} className="flex items-center justify-between py-0.5">
            <span className="text-zinc-600 dark:text-zinc-400">{desc}</span>
            <kbd className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 font-mono">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </section>
  );
};
