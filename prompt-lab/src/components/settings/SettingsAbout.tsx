import React from 'react';

// ── 关于 Tab ──

export const SettingsAbout: React.FC = () => {
  return (
    <section>
      <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
        关于
      </h4>
      <div className="text-[10px] text-zinc-500 space-y-0.5">
        <p>next-work-dashboard v0.2.0</p>
        <p>Electron + React + shadcn/ui + sql.js</p>
        <p>数据存储于本地，不上传任何服务器</p>
      </div>
    </section>
  );
};
