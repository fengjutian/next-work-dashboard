/**
 * WebContent — 中部 webview 容器（Phase 1.5）
 *
 * 升级点：
 *  - 用 Electron <webview> 替代 <iframe>，支持完整净化注入
 *  - 监听 webview ipc-message 接收 selectionchange
 *  - 选中文字后弹出 Annotation 浮动菜单
 *  - 净化走"网络层 session.webRequest" + "webview preload 注入 CSS/JS"双层
 */
import { Empty, Alert, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tab } from '../../../core/work-browser/types';
import { AnnotationPopover } from './AnnotationPopover';

export interface WebContentProps {
  tab: Tab | null;
  cleanerEnabled?: boolean;
  blockedDomains?: string[];
  /** 关联的 documentId；用户在 webview 里选中文字 → 弹 AnnotationPopover → 创建 annotation */
  activeDocumentId?: string;
  onSelectionChange?: (text: string, selector: string) => void;
}

declare global {
  interface HTMLElementTagNameMap {
    webview: Electron.WebviewTag;
  }
}

export function WebContent({ tab, cleanerEnabled, blockedDomains = [], activeDocumentId, onSelectionChange }: WebContentProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [preloadPath, setPreloadPath] = useState<string>('');
  const [selection, setSelection] = useState<{ text: string; selector: string; x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 取 webview-cleaner-preload 路径
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.workBrowser.cleaner.webviewPreloadPath().then((p) => {
      if (!cancelled && typeof p === 'string') setPreloadPath(p);
    });
    return () => { cancelled = true; };
  }, []);

  // 绑定 webview 事件
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onIpcMessage = (e: Electron.IpcMessageEvent) => {
      if (e.channel === 'work-browser:selection-changed') {
        const text = String((e.args?.[0] as any)?.text || '');
        const selector = String((e.args?.[0] as any)?.selector || '');
        if (text) {
          // 选区位置：使用 webview 中心
          const rect = wv.getBoundingClientRect();
          setSelection({ text, selector, x: rect.left + rect.width / 2, y: rect.top + 60 });
          onSelectionChange?.(text, selector);
        }
      } else if (e.channel === 'work-browser:selection-cleared') {
        setSelection(null);
      }
    };
    const onDidFinishLoad = () => setLoaded(true);
    const onDidStartLoading = () => setLoaded(false);

    wv.addEventListener('ipc-message', onIpcMessage);
    wv.addEventListener('did-finish-load', onDidFinishLoad);
    wv.addEventListener('did-start-loading', onDidStartLoading);
    return () => {
      wv.removeEventListener('ipc-message', onIpcMessage);
      wv.removeEventListener('did-finish-load', onDidFinishLoad);
      wv.removeEventListener('did-start-loading', onDidStartLoading);
    };
  }, [tab?.id, onSelectionChange]);

  const handleAnnotation = useCallback(async (note: string, color: string) => {
    if (!selection || !activeDocumentId) return;
    try {
      await window.electronAPI.workBrowser.annotation.create({
        documentId: activeDocumentId,
        selector: selection.selector,
        rangeText: selection.text,
        note,
        color,
      });
      setSelection(null);
    } catch (e) {
      console.error('[work-browser] annotation create failed:', e);
    }
  }, [selection, activeDocumentId]);

  if (!tab) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="选择或新建一个 Tab 开始浏览" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {(cleanerEnabled || blockedDomains.length > 0) && (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 0, padding: '4px 12px' }}
          message={
            <span>
              🛡 净化开启 · 网络层屏蔽 <Tag color="orange" style={{ marginLeft: 4 }}>{blockedDomains.length}</Tag> 个广告/跟踪器域 · DOM 层注入 CSS 选择器
            </span>
          }
        />
      )}
      {preloadPath ? (
        <webview
          key={tab.id}
          ref={webviewRef}
          src={tab.url}
          partition="persist:work-browser"
          preload={preloadPath}
          useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
          allowpopups={true}
          style={{ flex: 1, border: 'none', background: '#fff' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Tooltip title="webview-cleaner-preload 路径尚未就绪">
            <Tag>正在准备浏览器引擎…</Tag>
          </Tooltip>
        </div>
      )}
      {!loaded && preloadPath && (
        <div style={{ position: 'absolute', top: 8, right: 12, background: 'rgba(255,255,255,0.85)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
          ⏳ 加载中…
        </div>
      )}
      {selection && activeDocumentId && (
        <AnnotationPopover
          text={selection.text}
          x={selection.x}
          y={selection.y}
          onSave={handleAnnotation}
          onCancel={() => setSelection(null)}
        />
      )}
    </div>
  );
}
