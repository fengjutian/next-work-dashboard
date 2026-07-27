import { useEffect, useRef } from 'react';
import { useStore } from '@/store';

/**
 * 轻量 UI 状态持久化 — 仅保存 theme、injectMode 等非业务数据。
 * 业务数据（prompts、sites）已由 SQLite 管理，不再保存到 JSON。
 */
export function usePersistence() {
  const loaded = useRef(false);

  // 启动时加载 UI 状态
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    if (window.electronAPI?.loadData) {
      window.electronAPI.loadData().then((data: any) => {
        if (!data) return;
        const store = useStore.getState();
        useStore.setState({
          injectMode: data.injectMode || store.injectMode,
          theme: data.theme || store.theme,
        });
      });
    }
  }, []);

  // 自动保存 UI 状态
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (!window.electronAPI?.saveData) return;
      // 延迟合并写入，避免频繁 IO
      setTimeout(() => {
        window.electronAPI.saveData(
          JSON.stringify({
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
