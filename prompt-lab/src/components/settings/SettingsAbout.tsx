import React from 'react';
import { Info } from 'lucide-react';

// ── 关于 Tab ──

export const SettingsAbout: React.FC = () => {
  return (
    <section>
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        关于
      </h4>
      <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-xs">
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">
            next-work-dashboard v0.2.0
          </p>
          <p className="text-zinc-500">
            Electron + React + shadcn/ui + sql.js
          </p>
          <p className="text-zinc-400 text-[11px]">
            数据存储于本地，不上传任何服务器
          </p>
        </div>
      </div>
    </section>
  );
};
