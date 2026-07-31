import React from 'react';
import { Monitor, Moon, Sun } from '@/components/icons';
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
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        主题
      </h4>
      <div className="grid grid-cols-1 gap-2">
        {THEME_OPTIONS.map(({ value, icon: Icon, label, desc }) => (
          <button
            key={value}
            className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
              theme === value
                ? 'border-primary bg-primary-light text-primary'
                : 'border-border text-muted-foreground hover:border-border dark:hover:border-border'
            }`}
            onClick={() => setTheme(value)}
          >
            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-xs font-medium">{label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};
