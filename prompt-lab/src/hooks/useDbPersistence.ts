import { useEffect, useRef } from 'react';
import { initDb, isDbReady, flushDbToDisk } from '@/db';
import { useStore } from '@/store';

let _initialized = false;

/**
 * 数据库持久化 Hook
 * - 启动时从磁盘加载 SQLite → 初始化 → 可选 JSON 迁移 → 加载到 Zustand
 * - 定期自动保存 DB 文件
 * - 退出前保存
 */
export function useDbPersistence() {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (_initialized) return;
    _initialized = true;

    (async () => {
      // 1. 从主进程加载 DB 文件
      let buffer: ArrayBuffer | null = null;
      if (window.electronAPI?.db?.load) {
        buffer = await window.electronAPI.db.load();
      }

      // 2. 初始化 sql.js（含 auto-migrate schema）
      await initDb(buffer ?? undefined);

      // 3. 如果 DB 是全新的（之前没有文件），尝试从旧 JSON 迁移
      if (!buffer) {
        await migrateOldJsonIfExists();
      }

      // 4. 加载数据到 Zustand
      useStore.getState().loadFromDb();

      // 5. 恢复插件启用状态（持久化在 settings 表中）
      try {
        const { dbGetSetting } = await import('@/db');
        const { pluginRegistry } = await import('@/plugins');
        const saved = dbGetSetting('plugin.enabled');
        if (saved) {
          pluginRegistry.setEnabledMap(JSON.parse(saved));
        }
      } catch { /* 恢复失败不阻塞启动 */ }
    })();

    // 定期自动保存（每 30 秒，作为安全网）
    const interval = setInterval(async () => {
      await flushDbToDisk();
    }, 30000);

    // 退出前保存
    const beforeUnload = () => {
      flushDbToDisk();
    };
    window.addEventListener('beforeunload', beforeUnload);
    const cleanup = window.electronAPI?.onSaveBeforeQuit?.(beforeUnload);

    return () => {
      clearInterval(interval);
      clearTimeout(saveTimer.current);
      window.removeEventListener('beforeunload', beforeUnload);
      cleanup?.();
    };
  }, []);
}

/**
 * 如果旧 JSON 文件存在，将其中的 prompts/sites 迁移到 SQLite。
 * 只迁移一次：迁移完标记 JSON 中的 `_migrated: true`。
 */
async function migrateOldJsonIfExists(): Promise<void> {
  if (!window.electronAPI?.loadData) return;

  try {
    const data = await window.electronAPI.loadData();
    if (!data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    // 如果已经迁移过，跳过
    if (d._migrated) return;

    const { dbInsertPrompt, dbInsertSite } = await import('@/db');

    // 迁移 prompts
    if (Array.isArray(d.prompts)) {
      for (const p of d.prompts) {
        try { dbInsertPrompt(p); } catch { /* skip bad records */ }
      }
    }

    // 迁移 sites（合并默认站点）
    if (Array.isArray(d.sites)) {
      for (const s of d.sites) {
        try { dbInsertSite(s); } catch { /* skip bad records */ }
      }
    }

    // 标记已迁移
    if (window.electronAPI?.saveData) {
      await window.electronAPI.saveData(
        JSON.stringify({ ...d, _migrated: true, prompts: d.prompts, sites: d.sites })
      );
    }
  } catch {
    // 迁移失败不阻塞启动
  }
}
