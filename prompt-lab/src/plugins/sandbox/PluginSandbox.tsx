import React, { useMemo } from 'react';
import type { PluginPermission } from './types';
import { usePluginBridge } from './usePluginBridge';
import { PLUGIN_SDK_SOURCE } from './plugin-sdk';

interface PluginSandboxProps {
  pluginId: string;
  script: string;
  style?: string;
  permissions: PluginPermission[];
  className?: string;
}

const BASE_STYLES = `
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
`;

export const PluginSandbox: React.FC<PluginSandboxProps> = ({
  pluginId,
  script,
  style,
  permissions,
  className = '',
}) => {
  const { bridgeProps } = usePluginBridge({ pluginId, permissions });

  const srcdoc = useMemo(() => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:">
  <style>${BASE_STYLES}</style>
  ${style ? `<style>${style}</style>` : ''}
</head>
<body>
  <div id="root"></div>
  <script>
    window.onerror=function(message,source,line){window.parent.postMessage({requestId:'error',channel:'ui',method:'error',error:String(message)+(line!=null?' (line '+line+')':'')},'*')};
    window.onunhandledrejection=function(event){window.parent.postMessage({requestId:'error',channel:'ui',method:'error',error:'Unhandled: '+String(event.reason)},'*')};
  </script>
  <script>${PLUGIN_SDK_SOURCE}</script>
  <script>${script}</script>
</body>
</html>`, [script, style]);

  return (
    <iframe
      ref={bridgeProps.ref}
      onLoad={bridgeProps.onLoad}
      className={`w-full h-full border-0 ${className}`}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      title={`plugin-${pluginId}`}
    />
  );
};

export default PluginSandbox;
