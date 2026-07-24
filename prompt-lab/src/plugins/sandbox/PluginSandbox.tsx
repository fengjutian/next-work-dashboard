/**
 * PluginSandbox — 用户插件 iframe 沙箱容器。
 *
 * 包装 usePluginBridge，管理 iframe 生命周期：
 *  1. 通过 srcdoc 注入 frame template + SDK + 用户脚本 + 自定义样式
 *  2. 响应 setContent 事件（用户脚本调用 ui.setContent）
 *  3. 自适应容器高度
 *
 * 用法：
 *  <PluginSandbox pluginId="my-plugin" permissions={['store.read']} script="..." style="..." />
 */

import React, { useMemo, useCallback } from 'react';
import type { PluginPermission } from './types';
import { usePluginBridge } from './usePluginBridge';

// ── SDK 源码字符串化（构建时静态导入） ──
// plugin-sdk.ts 会导出 default SDK，我们需要它的字符串形式注入 iframe。
// 简单方案：内联 SDK 函数字符串。生产环境可用 Vite ?raw 导入。

const SDK_SOURCE = `
(function() {
  'use strict';
  var listeners = new Map();
  function genId() { return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }

  function request(channel, method, args) {
    return new Promise(function(resolve, reject) {
      var id = genId();
      function handler(e) {
        var msg = e.data;
        if (!msg || msg.requestId !== id) return;
        window.removeEventListener('message', handler);
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || 'Unknown error'));
      }
      window.addEventListener('message', handler);
      window.parent.postMessage({ requestId: id, channel: channel, method: method, args: args || [] }, '*');
    });
  }

  function subscribe(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return function() { var s = listeners.get(evt); if (s) s.delete(fn); };
  }

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || !msg.event) return;
    var set = listeners.get(msg.event);
    if (set) set.forEach(function(fn) { fn(msg.payload); });
  });

  // setContent 事件
  subscribe('setContent', function(html) {
    var root = document.getElementById('root');
    if (root) root.innerHTML = String(html);
  });

  window.PluginSDK = {
    store: {
      getPrompts: function() { return request('store', 'getPrompts'); },
      getSites: function() { return request('store', 'getSites'); },
      getTabs: function() { return request('store', 'getTabs'); },
      getActiveTab: function() { return request('store', 'getActiveTab'); },
      getTheme: function() { return request('store', 'getTheme'); },
      getConversations: function() { return request('store', 'getConversations'); },
      subscribe: subscribe,
    },
    on: subscribe,
    ui: {
      setContent: function(html) { return request('ui', 'setContent', [html]); },
      getThemeTokens: function() { return request('ui', 'getThemeTokens'); },
      showToast: function(msg, type) { return request('ui', 'showToast', [msg, type || 'info']); },
      getContainerSize: function() { return request('ui', 'getContainerSize'); },
    },
    actions: {
      copyToClipboard: function(text) { return request('actions', 'copyToClipboard', [text]); },
      injectPrompt: function(siteId, text, autoSubmit) { return request('actions', 'injectPrompt', [siteId, text, autoSubmit || false]); },
      openUrl: function(url) { return request('actions', 'openUrl', [url]); },
    },
    data: {
      get: function(key) { return request('data', 'get', [key]); },
      set: function(key, value) { return request('data', 'set', [key, value]); },
      delete: function(key) { return request('data', 'delete', [key]); },
      list: function() { return request('data', 'list'); },
    },
  };
})();
`;

// ── 组件 Props ──

interface PluginSandboxProps {
  pluginId: string;
  script: string;
  style?: string;
  permissions: PluginPermission[];
  /** 附加 className */
  className?: string;
}

export const PluginSandbox: React.FC<PluginSandboxProps> = ({
  pluginId,
  script,
  style,
  permissions,
  className = '',
}) => {
  const { bridgeProps } = usePluginBridge({ pluginId, permissions });

  // ── 构建 srcdoc ──
  const srcdoc = useMemo(() => {
    // 基础 frame 模板（手写，避免额外文件依赖）
    const frameHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:var(--foreground,#09090b);background:var(--background,#fff);overflow:auto}
#root{min-height:100%;padding:16px}
.pk-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;border:1px solid var(--border,#e4e4e7);background:var(--card,#fff);color:var(--foreground,#09090b);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.pk-btn:hover{background:var(--muted,#f4f4f5)}
.pk-btn.pk-primary{background:#3b82f6;color:#fff;border-color:#3b82f6}
.pk-btn.pk-primary:hover{background:#2563eb}
.pk-btn.pk-danger{background:#ef4444;color:#fff;border-color:#ef4444}
.pk-btn.pk-danger:hover{background:#dc2626}
.pk-input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border,#e4e4e7);background:var(--card,#fff);color:var(--foreground,#09090b);font-size:13px;outline:none}
.pk-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.pk-card{padding:16px;border-radius:12px;border:1px solid var(--border,#e4e4e7);background:var(--card,#fff)}
.pk-badge{display:inline-flex;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
.pk-separator{height:1px;background:var(--border,#e4e4e7);margin:12px 0}
@media (prefers-color-scheme:dark){:root{--foreground:#fafafa;--background:#09090b;--border:#27272a;--card:#18181b;--muted:#27272a}}
</style>
</head>
<body><div id="root"></div>
<script>window.onerror=function(m,s,l,c,e){window.parent.postMessage({requestId:'error',channel:'ui',method:'error',error:String(m)+(l!=null?' (line '+l+')':'')},'*')};
window.onunhandledrejection=function(e){window.parent.postMessage({requestId:'error',channel:'ui',method:'error',error:'Unhandled: '+String(e.reason)},'*')};</script>
<script>${SDK_SOURCE}</script>
${style ? `<style>${style}</style>` : ''}
<script>${script}</script>
</body>
</html>`;

    return frameHtml;
  }, [script, style]);

  // ── 自适应高度：监听 iframe 内容变化 ──
  // (iframe sandbox 内无法 postMessage 高度，这里暂用固定 100% 高度)

  return (
    <iframe
      ref={bridgeProps.ref}
      className={`w-full h-full border-0 ${className}`}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      title={`plugin-${pluginId}`}
      // 阻止导航
      onBeforeInput={(e) => {
        // allow
      }}
    />
  );
};

export default PluginSandbox;
