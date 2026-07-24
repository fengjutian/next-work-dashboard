import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useStore } from '@/store';

// ── 外观设置 Tab ──

const THEME_OPTIONS = [
  { value: 'light' as const, icon: Sun, label: '浅色', desc: '始终使用浅色主题' },
  { value: 'dark' as const, icon: Moon, label: '深色', desc: '始终使用深色主题' },
  { value: 'system' as const, icon: Monitor, label: '跟随系统', desc: '根据系统设置自动切换' },
];

export const SettingsAppearance: React.FC = () => {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <section>
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        主题
      </h4>
      <div className="grid grid-cols-1 gap-2">
        {THEME_OPTIONS.map(({ value, icon: Icon, label, desc }) => (
          <button
            key={value}
            className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
              theme === value
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
            onClick={() => setTheme(value)}
          >
            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-xs font-medium">{label}</div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                {desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};
