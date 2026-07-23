import { useEffect, useRef } from 'react';
import { useStore } from '@/store';

// ── 持久化 Hook ──
// 在 App 组件中调用一次，自动处理加载和保存

export function usePersistence() {
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const prompts = useStore((s) => s.prompts);
  const sites = useStore((s) => s.sites);
  const injectMode = useStore((s) => s.injectMode);

  // 启动时加载
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    if (window.electronAPI?.loadData) {
      window.electronAPI.loadData().then((data: any) => {
        if (!data) return;

        const store = useStore.getState();

        if (data.prompts?.length) {
          // 替换初始数据（去重：如果 store 已有相同 ID，跳过）
          const existingIds = new Set(store.prompts.map((p) => p.id));
          data.prompts.forEach((p: any) => {
            if (!existingIds.has(p.id)) {
              store.addPrompt(p);
            }
          });
        }
        if (data.sites?.length) {
          // 只恢复自定义站点 + 更新预设站点
          const existingIds = new Set(store.sites.map((s) => s.id));
          data.sites.forEach((s: any) => {
            if (existingIds.has(s.id)) {
              store.updateSite(s.id, s);
            } else {
              store.addSite(s);
            }
          });
        }
        if (data.injectMode) {
          store.setInjectMode(data.injectMode);
        }
      });
    }
  }, []);

  // 变更时自动保存（防抖 2 秒）
  useEffect(() => {
    if (!window.electronAPI?.saveData) return;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const state = useStore.getState();
      const payload = {
        prompts: state.prompts,
        sites: state.sites,
        injectMode: state.injectMode,
      };
      window.electronAPI.saveData(JSON.stringify(payload));
    }, 2000);
  }, [prompts, sites, injectMode]);

  // 页面关闭/托盘退出时保存
  useEffect(() => {
    const save = () => {
      if (!window.electronAPI?.saveData) return;
      const state = useStore.getState();
      window.electronAPI.saveData(JSON.stringify({
        prompts: state.prompts,
        sites: state.sites,
        injectMode: state.injectMode,
      }));
    };
    window.addEventListener('beforeunload', save);
    const cleanup = window.electronAPI?.onSaveBeforeQuit(save);
    return () => {
      window.removeEventListener('beforeunload', save);
      cleanup?.();
    };
  }, []);
}
