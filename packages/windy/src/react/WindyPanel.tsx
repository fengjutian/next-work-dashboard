/**
 * Windy weather visualization panel.
 *
 * Hosts an Electron `<webview>` running windy.com. Host-agnostic: the
 * `WindyWebviewElement` interface declares the minimum surface used
 * here. Hosts that ship a real `Electron.WebviewTag` (or compatible
 * polyfill) can assign it directly to the ref.
 */

import React, { useRef } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';

interface WindyWebviewElement {
  goBack(): void;
  goForward(): void;
  reload(): void;
}

export interface WindyPanelProps {
  /** Override the URL the webview loads. Defaults to `https://www.windy.com/`. */
  src?: string;
  /** Override the webview session partition. Defaults to `persist:windy`. */
  partition?: string;
}

export const WindyPanel: React.FC<WindyPanelProps> = ({ src = 'https://www.windy.com/', partition = 'persist:windy' }) => {
  const webviewRef = useRef<WindyWebviewElement | null>(null);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 导航栏 */}
      <div className="h-8 flex items-center px-2 gap-1 bg-background border-b">
        <button
          type="button"
          onClick={() => webviewRef.current?.goBack()}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label="后退"
          title="后退"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => webviewRef.current?.goForward()}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label="前进"
          title="前进"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => webviewRef.current?.reload()}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label="刷新"
          title="刷新"
        >
          <RefreshCw className="h-3 w-3" />
        </button>

        <span className="flex-1 text-xs text-muted-foreground truncate px-2">
          🌬️ Windy
        </span>
      </div>

      {/* webview 内容区 */}
      <webview
        ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
        src={src}
        partition={partition}
        style={{ flex: 1 }}
        // @ts-expect-error webview-specific attribute
        allowpopups="true"
      />
    </div>
  );
};
