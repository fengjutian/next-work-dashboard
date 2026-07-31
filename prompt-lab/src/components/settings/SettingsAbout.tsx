import React from 'react';
import { Info } from '@/components/icons';

// ── 关于 Tab ──

export const SettingsAbout: React.FC = () => {
  return (
    <section>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        关于
      </h4>
      <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
        <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-xs">
          <p className="font-semibold text-foreground">
            next-work-dashboard v0.2.0
          </p>
          <p className="text-muted-foreground">
            Electron + React + shadcn/ui + sql.js
          </p>
          <p className="text-muted-foreground text-[11px]">
            数据存储于本地，不上传任何服务器
          </p>
        </div>
      </div>
    </section>
  );
};
