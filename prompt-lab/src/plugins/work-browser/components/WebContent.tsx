/**
 * WebContent — 中部 webview 容器（Phase 1.5）
 *
 * 升级点：
 *  - 用 Electron <webview> 替代 <iframe>，支持完整净化注入
 *  - 监听 webview ipc-message 接收 selectionchange
 *  - 选中文字后弹出 Annotation 浮动菜单
 *  - 净化走"网络层 session.webRequest" + "webview preload 注入 CSS/JS"双层
 */
import { Empty, Alert, Tag, Tooltip, Button, Space, Typography } from '../ui';
import { X } from 'lucide-react';
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
  const [annotationPanel, setAnnotationPanel] = useState<{ id: string; note: string; rangeText: string; color: string; url: string } | null>(null);
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
      } else if (e.channel === 'work-browser:annotation-clicked') {
        const data = e.args?.[0] as any;
        setAnnotationPanel({
          id: String(data?.id || ''),
          note: String(data?.note || ''),
          rangeText: String(data?.rangeText || ''),
          color: (data?.color as any) || 'yellow',
          url: String(data?.url || ''),
        });
      } else if (e.channel === 'work-browser:annotations-rendered') {
        const total = (e.args?.[0] as any)?.total ?? 0;
        const hit = (e.args?.[0] as any)?.hit ?? 0;
        if (total > 0) {
          console.info(`[work-browser] rendered ${hit}/${total} annotations`);
        }
      }
    };
    const onDidFinishLoad = () => {
      setLoaded(true);
      // 主动触发 webview 内部重读 annotations
      void wv.executeJavaScript(`window.postMessage({type: 'work-browser-refresh-annotations'}, '*');`).catch(() => undefined);
    };
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
      {annotationPanel && (
        <AnnotationSidePanel
          annotation={annotationPanel}
          onClose={() => setAnnotationPanel(null)}
        />
      )}
    </div>
  );
}

function AnnotationSidePanel({ annotation, onClose }: { annotation: { id: string; note: string; rangeText: string; color: string; url: string }; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 360,
        height: '100vh',
        background: '#fff',
        borderLeft: '1px solid #e0e0e0',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
        zIndex: 1100,
        padding: 16,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: { yellow: '#fff59d', green: '#a5d6a7', red: '#ef9a9a', blue: '#90caf9', purple: '#ce93d8' }[annotation.color as 'yellow' | 'green' | 'red' | 'blue' | 'purple'] || '#fff59d' }} />
          <Typography.Text strong>笔记</Typography.Text>
        </Space>
        <Button size="small" type="text" icon={<X size={14} />} onClick={onClose} />
      </div>
      <Typography.Paragraph style={{ padding: 8, background: '#fafafa', borderRadius: 4, fontSize: 13 }}>
        "{annotation.rangeText}"
      </Typography.Paragraph>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
        {annotation.note || <Typography.Text type="secondary">（无笔记内容）</Typography.Text>}
      </Typography.Paragraph>
      {annotation.url && (
        <Typography.Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
          来源：{annotation.url}
        </Typography.Text>
      )}
    </div>
  );
}
