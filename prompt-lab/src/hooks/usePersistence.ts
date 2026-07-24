import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import type { SiteConfig } from '@/store';

// ── 持久化 Hook ──
// 使用 Zustand subscribe（在 React 渲染周期外运行）避免无限重渲染

export function usePersistence() {
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // 启动时加载（仅一次）
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    if (window.electronAPI?.loadData) {
      window.electronAPI.loadData().then((data: any) => {
        if (!data) return;

        const store = useStore.getState();
        const existingPromptIds = new Set(store.prompts.map((p) => p.id));
        const existingSiteIds = new Set(store.sites.map((s) => s.id));

        // 批量恢复 — 一次 set 避免多轮通知
        const newPrompts = [...store.prompts];
        let promptsChanged = false;
        if (data.prompts?.length) {
          data.prompts.forEach((p: any) => {
            if (!existingPromptIds.has(p.id)) {
              newPrompts.push(p);
              promptsChanged = true;
            }
          });
        }

        const newSites = store.sites.map((s: SiteConfig) => {
          const saved = (data.sites || []).find((ss: any) => ss.id === s.id);
          return saved ? { ...s, ...saved } : s;
        });
        (data.sites || []).forEach((s: any) => {
          if (!existingSiteIds.has(s.id)) newSites.push(s);
        });

        // 单次 set 合并所有变更
        useStore.setState({
          prompts: promptsChanged ? newPrompts : store.prompts,
          sites: newSites,
          injectMode: data.injectMode || store.injectMode,
          theme: data.theme || store.theme,
        });
      });
    }
  }, []);

  // 自动保存 — 使用 subscribe 而非 useEffect 避免 deps 循环
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (!window.electronAPI?.saveData) return;

      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        window.electronAPI.saveData(
          JSON.stringify({
            prompts: state.prompts,
            sites: state.sites,
            injectMode: state.injectMode,
            theme: state.theme,
          })
        );
      }, 2000);
    });

    return unsub;
  }, []);

  // 退出前保存
  useEffect(() => {
    const save = () => {
      if (!window.electronAPI?.saveData) return;
      const state = useStore.getState();
      window.electronAPI.saveData(
        JSON.stringify({
          prompts: state.prompts,
          sites: state.sites,
          injectMode: state.injectMode,
          theme: state.theme,
        })
      );
    };
    window.addEventListener('beforeunload', save);
    const cleanup = window.electronAPI?.onSaveBeforeQuit(save);
    return () => {
      window.removeEventListener('beforeunload', save);
      cleanup?.();
    };
  }, []);
}
