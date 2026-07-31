import React, { useRef } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';

/**
 * WindyPlugin — Windy 天气可视化面板
 *
 * 使用 Electron <webview> 标签替代 <iframe>：
 *   - webview 运行在独立 Chromium 渲染进程中，拥有完整的浏览器特征
 *   - 不被检测为"第三方插件"（window.top === window.self）
 *   - 独立的 session/partition 持久化登录态
 */
export const WindyPanel: React.FC = () => {
  const webviewRef = useRef<Electron.WebviewTag>(null);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 导航栏 */}
      <div className="h-8 flex items-center px-2 gap-1 bg-background border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => webviewRef.current?.reload()}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>

        <span className="flex-1 text-xs text-muted-foreground truncate px-2">
          🌬️ Windy
        </span>
      </div>

      {/* webview 内容区 */}
      <webview
        ref={webviewRef}
        src="https://www.windy.com/"
        partition="persist:windy"
        style={{ flex: 1 }}
        // @ts-expect-error webview-specific attribute
        allowpopups="true"
      />
    </div>
  );
};
