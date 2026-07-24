import React from 'react';
import { ImportExport } from '@/components/ImportExport';

// ── 数据管理 Tab ──

export const SettingsDataManagement: React.FC = () => {
  return (
    <section>
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        数据管理
      </h4>
      <ImportExport />
    </section>
  );
};
