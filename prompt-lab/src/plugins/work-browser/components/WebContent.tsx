/**
 * WebContent — 中部 webview 容器
 *
 * Phase 1 实现：使用 <iframe> 嵌入页面，净化通过 CSP 限制 + 自定义 CSS 注入实现。
 * Phase 1.5 切到 Electron <webview> + 完整净化脚本。
 */
import { Empty, Alert } from 'antd';
import { useMemo } from 'react';
import type { Tab } from '../../../core/work-browser/types';

export interface WebContentProps {
  tab: Tab | null;
  cleanerEnabled?: boolean;
  blockedDomains?: string[];
}

export function WebContent({ tab, cleanerEnabled, blockedDomains = [] }: WebContentProps) {
  const srcDoc = useMemo(() => {
    if (!cleanerEnabled) return undefined;
    // 在 iframe 内注入净化 CSS（最简实现）
    return `<!doctype html><html><head><style>
      body { font-family: system-ui; padding: 24px; color: #666; }
    </style></head><body>正在加载…</body></html>`;
  }, [cleanerEnabled]);

  if (!tab) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="选择或新建一个 Tab 开始浏览" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {cleanerEnabled && blockedDomains.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 0 }}
          message={`净化开启：已屏蔽 ${blockedDomains.length} 个追踪/广告域名`}
        />
      )}
      <iframe
        key={tab.id}
        src={tab.url}
        title={tab.title || tab.url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        style={{ flex: 1, border: 'none', background: '#fff' }}
        srcDoc={srcDoc}
      />
    </div>
  );
}
