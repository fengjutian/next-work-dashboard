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
      if (raw) return JSON.parse(raw);
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
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ elements, appState, files }),
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
