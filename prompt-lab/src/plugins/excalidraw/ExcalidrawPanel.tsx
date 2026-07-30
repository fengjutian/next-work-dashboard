import React, { useCallback, useMemo } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

/** 存储 key，用于持久化绘图数据到 localStorage */
const STORAGE_KEY = 'excalidraw-scene';

export const ExcalidrawPanel: React.FC = () => {
  /** 从 localStorage 恢复初始数据 */
  const initialData = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        // collaborators 是运行时 Map，JSON 序列化后会变成 {}，
        // 导致 Excalidraw 内部调用 .forEach 时报错
        if (data?.appState?.collaborators) {
          delete data.appState.collaborators;
        }
        return data;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  /** 每次绘图变化时持久化 */
  const handleChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements: any, appState: any, files: any) => {
      try {
        // collaborators 是运行时 Map，无法被 JSON 正确序列化，
        // 序列化后会变成 {} 导致下次加载时 .forEach 报错
        const { collaborators: _, ...restAppState } = appState ?? {};
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ elements, appState: restAppState, files }),
        );
      } catch {
        /* localStorage 满或序列化失败，静默忽略 */
      }
    },
    [],
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Excalidraw
        initialData={initialData}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={handleChange as any}
        UIOptions={{
          canvasActions: {
            export: { saveFileToDisk: true },
            loadScene: true,
            saveToActiveFile: false,
            saveAsImage: true,
          },
        }}
      />
    </div>
  );
};
