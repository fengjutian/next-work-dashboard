import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useStore } from '@/store';

// ── 外观设置 Tab ──

const THEME_OPTIONS = [
  { value: 'light' as const, icon: Sun, label: '浅色' },
  { value: 'dark' as const, icon: Moon, label: '深色' },
  { value: 'system' as const, icon: Monitor, label: '跟随系统' },
];

export const SettingsAppearance: React.FC = () => {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <section>
      <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
        外观
      </h4>
      <div className="flex flex-col gap-1.5">
        {THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors ${
              theme === value
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
            }`}
            onClick={() => setTheme(value)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
};
