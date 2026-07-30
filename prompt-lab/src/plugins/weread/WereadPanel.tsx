import React, { useRef } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';

/**
 * WereadPlugin — 微信读书面板
 *
 * 使用 Electron <webview> 标签替代 <iframe>：
 *   - webview 运行在独立 Chromium 渲染进程中，拥有完整的浏览器特征
 *   - 不被检测为"第三方插件"（window.top === window.self）
 *   - 独立的 session/partition 持久化登录态
 */
export const WereadPanel: React.FC = () => {
  const webviewRef = useRef<Electron.WebviewTag>(null);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 导航栏 */}
      <div className="h-8 flex items-center px-2 gap-1 bg-zinc-50 dark:bg-zinc-900 border-b">
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

        <span className="flex-1 text-xs text-zinc-400 truncate px-2">
          📖 微信读书
        </span>
      </div>

      {/* webview 内容区 */}
      <webview
        ref={webviewRef}
        src="https://weread.qq.com/"
        partition="persist:weread"
        style={{ flex: 1 }}
        // @ts-expect-error webview-specific attribute
        allowpopups="true"
      />
    </div>
  );
};
