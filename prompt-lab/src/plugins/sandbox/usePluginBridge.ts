/**
 * usePluginBridge — Host 侧 postMessage 桥接器。
 *
 * 职责：
 *  1. 接收 iframe postMessage → 路由到对应的 API 实现
 *  2. 管理插件私有存储（按 pluginId 命名空间隔离）
 *  3. 发送事件推送（store 变更等）
 *
 * 用法：
 *  const { bridgeProps, postEvent } = usePluginBridge(pluginId, permissions);
 *  <iframe {...bridgeProps} />
 */

import { useCallback, useEffect, useRef } from 'react';
import type { SandboxMessage, PluginPermission } from './types';
import { useStore } from '@/store';
import { pluginStorage } from '../plugin-storage';
import { pluginRegistry } from '../registry';

interface UsePluginBridgeOptions {
  pluginId: string;
  permissions: PluginPermission[];
}

interface UsePluginBridgeReturn {
  /** 直接传给 <iframe> 的事件处理器 */
  bridgeProps: {
    ref: React.RefObject<HTMLIFrameElement | null>;
    onLoad: () => void;
  };
  /** 向 iframe 推送事件 */
  postEvent: (event: string, payload: unknown) => void;
}

// ── 插件私有存储（按 pluginId 命名空间隔离） ──

const MAX_MESSAGE_SIZE = 256 * 1024;
const MAX_PLUGIN_STORAGE_SIZE = 512 * 1024;
const VALID_CHANNELS = new Set(['store', 'ui', 'actions', 'data', 'preview', 'file', 'config']);
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function validateMessage(value: unknown): value is SandboxMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Partial<SandboxMessage>;
  if (typeof msg.requestId !== 'string' || msg.requestId.length < 1 || msg.requestId.length > 128) return false;
  if (typeof msg.channel !== 'string' || !VALID_CHANNELS.has(msg.channel)) return false;
  if (typeof msg.method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(msg.method)) return false;
  if (msg.args !== undefined && (!Array.isArray(msg.args) || msg.args.length > 8)) return false;
  try {
    return JSON.stringify(value).length <= MAX_MESSAGE_SIZE;
  } catch {
    return false;
  }
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${field} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function requireStorageKey(value: unknown): string {
  const key = requireString(value, 'key', 128);
  if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new Error('Invalid storage key');
  }
  return key;
}

function getPluginStore(pluginId: string): Record<string, unknown> {
  return pluginStorage.getData(pluginId);
}

function setPluginStore(pluginId: string, store: Record<string, unknown>): void {
  const serialized = JSON.stringify(store);
  if (serialized.length > MAX_PLUGIN_STORAGE_SIZE) {
    throw new Error('Plugin storage quota exceeded (512 KB)');
  }
  pluginStorage.setData(pluginId, store);
}

export function usePluginBridge({
  pluginId,
  permissions,
}: UsePluginBridgeOptions): UsePluginBridgeReturn {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const grantedPermissions = pluginStorage.getGrants(pluginId);
  const hasPermission = (permission: PluginPermission) =>
    permissions.includes(permission) && grantedPermissions.includes(permission);

  // ── 读取 Store（在 ref 中保持最新，避免闭包陷阱） ──
  const storeRef = useRef(useStore.getState());
  useEffect(() => {
    const unsub = useStore.subscribe((s) => {
      storeRef.current = s;
    });
    return unsub;
  }, []);

  // ── postMessage 辅助 ──
  const respond = useCallback(
    (requestId: string, ok: boolean, result?: unknown, error?: string) => {
      iframeRef.current?.contentWindow?.postMessage(
        { requestId, ok, result, error } satisfies Partial<SandboxMessage>,
        '*',
      );
    },
    [],
  );

  const postEvent = useCallback(
    (event: string, payload: unknown) => {
      iframeRef.current?.contentWindow?.postMessage(
        { event, payload } satisfies Partial<SandboxMessage>,
        '*',
      );
    },
    [],
  );

  // ── API 路由 ──
  const handleMessage = useCallback(
    (msg: SandboxMessage) => {
      const { requestId, channel, method, args = [] } = msg;

      try {
        switch (channel) {
          // ── store ──
          case 'store': {
            if (!hasPermission('store.read')) {
              respond(requestId, false, undefined, '缺少权限: store.read');
              return;
            }
            const s = storeRef.current;
            switch (method) {
              case 'getPrompts':
                respond(requestId, true, s.prompts.map((p) => ({
                  id: p.id, title: p.title, content: p.content,
                  category: p.category, tags: p.tags,
                  isFavorite: p.isFavorite, isPinned: p.isPinned,
                  usageCount: p.usageCount,
                })));
                break;
              case 'getSites':
                respond(requestId, true, s.sites.map((site) => ({
                  id: site.id, name: site.name, url: site.url, enabled: site.enabled,
                })));
                break;
              case 'getTabs':
                respond(requestId, true, s.tabs);
                break;
              case 'getActiveTab':
                respond(requestId, true, s.tabs.find((t) => t.id === s.activeTabId) ?? null);
                break;
              case 'getTheme':
                respond(requestId, true, s.theme);
                break;
              case 'getConversations':
                // 异步 IPC 调用
                (window as any).electronAPI
                  ?.listConversations()
                  .then((list: unknown) => respond(requestId, true, list))
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return; // 不执行后面的同步返回
              default:
                respond(requestId, false, undefined, `未知 store 方法: ${method}`);
                break;
            }
            return;
          }

          // ── ui ──
          case 'ui': {
            switch (method) {
              case 'error': {
                const message = requireString(msg.error ?? args[0] ?? 'Sandbox error', 'error', 4_000);
                pluginStorage.appendLog(pluginId, { timestamp: Date.now(), level: 'error', message });
                if (pluginStorage.recordCrash(pluginId) >= 3) pluginRegistry.setEnabled(pluginId, false);
                respond(requestId, true);
                break;
              }
              case 'setContent': {
                const html = requireString(args[0] ?? '', 'html', 200_000);
                iframeRef.current?.contentWindow?.postMessage(
                  { event: 'setContent', payload: html },
                  '*',
                );
                respond(requestId, true);
                break;
              }
              case 'getThemeTokens':
                respond(requestId, true, {
                  '--foreground': 'var(--foreground, #09090b)',
                  '--background': 'var(--background, #ffffff)',
                  '--border': 'var(--border, #e4e4e7)',
                  '--card': 'var(--card, #ffffff)',
                  '--muted': 'var(--muted, #f4f4f5)',
                });
                break;
              case 'showToast': {
                const message = requireString(args[0] ?? '', 'message', 2_000);
                // TODO: 对接 toast 系统
                console.log(`[PluginSDK Toast] ${message}`);
                respond(requestId, true);
                break;
              }
              case 'getContainerSize': {
                const el = iframeRef.current?.parentElement;
                respond(requestId, true, {
                  w: el?.clientWidth ?? 400,
                  h: el?.clientHeight ?? 600,
                });
                break;
              }
              default:
                respond(requestId, false, undefined, `未知 ui 方法: ${method}`);
                break;
            }
            return;
          }

          // ── actions ──
          case 'actions': {
            switch (method) {
              case 'copyToClipboard': {
                if (!hasPermission('clipboard')) {
                  respond(requestId, false, undefined, '缺少权限: clipboard');
                  return;
                }
                const text = requireString(args[0] ?? '', 'text', 1_000_000);
                (window as any).electronAPI
                  ?.copyText(text)
                  .then(() => respond(requestId, true))
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return;
              }
              case 'injectPrompt': {
                if (!hasPermission('inject')) {
                  respond(requestId, false, undefined, '缺少权限: inject');
                  return;
                }
                const [siteId, text, autoSubmit] = args as [string, string, boolean?];
                requireString(siteId, 'siteId', 128);
                requireString(text, 'text', 1_000_000);
                if (autoSubmit !== undefined && typeof autoSubmit !== 'boolean') {
                  throw new Error('autoSubmit must be a boolean');
                }
                const store = storeRef.current;
                const site = store.sites.find((s) => s.id === siteId);
                if (!site) {
                  respond(requestId, false, undefined, `站点不存在: ${siteId}`);
                  return;
                }
                const tab = store.tabs.find((t) => t.siteId === siteId);
                if (!tab) {
                  respond(requestId, false, undefined, `请先打开站点: ${siteId}`);
                  return;
                }
                // 通过 webview 注入（使用 electronAPI）
                (window as any).electronAPI
                  ?.injectPrompt({
                    webviewId: parseInt(tab.id.replace(/\D/g, ''), 10) || 0,
                    text,
                    inputSelector: site.inputSelector,
                    submitSelector: site.submitSelector || undefined,
                    autoSubmit: autoSubmit ?? false,
                  })
                  .then(() => {
                    store.recordInject('plugin:' + pluginId, siteId);
                    respond(requestId, true);
                  })
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return;
              }
              case 'openUrl': {
                if (!hasPermission('external.open')) {
                  respond(requestId, false, undefined, '缺少权限: external.open');
                  return;
                }
                const rawUrl = requireString(args[0] ?? '', 'url', 2_048);
                let url: URL;
                try {
                  url = new URL(rawUrl);
                } catch {
                  throw new Error('Invalid external URL');
                }
                if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) || url.username || url.password) {
                  throw new Error(`External URL protocol is not allowed: ${url.protocol}`);
                }
                window.open(url.href, '_blank', 'noopener,noreferrer');
                respond(requestId, true);
                return;
              }
              default:
                respond(requestId, false, undefined, `未知 actions 方法: ${method}`);
                break;
            }
            return;
          }

          // ── data (插件私有存储) ──
          case 'data': {
            if (!hasPermission('data')) {
              respond(requestId, false, undefined, '缺少权限: data');
              return;
            }
            const store = getPluginStore(pluginId);
            switch (method) {
              case 'get':
                respond(requestId, true, store[requireStorageKey(args[0])]);
                break;
              case 'set': {
                const key = requireStorageKey(args[0]);
                store[key] = args[1];
                setPluginStore(pluginId, store);
                respond(requestId, true);
                break;
              }
              case 'delete': {
                delete store[requireStorageKey(args[0])];
                setPluginStore(pluginId, store);
                respond(requestId, true);
                break;
              }
              case 'list':
                respond(requestId, true, Object.keys(store));
                break;
              default:
                respond(requestId, false, undefined, `未知 data 方法: ${method}`);
                break;
            }
            return;
          }

          // ── preview (内容预览) ──
          case 'preview': {
            if (!hasPermission('preview')) {
              respond(requestId, false, undefined, '缺少权限: preview');
              return;
            }
            switch (method) {
              case 'markdown': {
                const content = String(args[0] ?? '');
                // 通过 setContent 事件推送渲染后的 HTML
                // 简单 Markdown → HTML 转换（内联处理）
                const html = content
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                  .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\*(.+?)\*/g, '<em>$1</em>')
                  .replace(/`([^`]+)`/g, '<code>$1</code>')
                  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
                  .replace(/\n\n/g, '</p><p>')
                  .replace(/\n/g, '<br/>');
                iframeRef.current?.contentWindow?.postMessage(
                  { event: 'setContent', payload: `<div class="pk-card"><div class="prose">${html}</div></div>` },
                  '*',
                );
                respond(requestId, true);
                break;
              }
              case 'image': {
                const [src, alt] = args as [string, string?];
                const imgHtml = `<div class="pk-card" style="text-align:center">
                  <img src="${src.replace(/"/g, '&quot;')}" alt="${(alt ?? '预览').replace(/"/g, '&quot;')}"
                       style="max-width:100%;max-height:70vh;border-radius:8px;object-fit:contain"
                       onerror="this.parentElement.innerHTML='<p style=\\'color:var(--foreground)\\'>图片加载失败</p>'" />
                  ${alt ? `<p style="margin-top:8px;font-size:12px;color:var(--muted)">${alt.replace(/"/g, '&quot;')}</p>` : ''}
                </div>`;
                iframeRef.current?.contentWindow?.postMessage(
                  { event: 'setContent', payload: imgHtml },
                  '*',
                );
                respond(requestId, true);
                break;
              }
              case 'pdf': {
                const src = String(args[0] ?? '');
                // 使用 embed 标签嵌入 PDF
                const pdfHtml = `<div class="pk-card" style="padding:0;overflow:hidden;height:100%">
                  <embed src="${src.replace(/"/g, '&quot;')}" type="application/pdf"
                         style="width:100%;height:100%;min-height:70vh;border:0;border-radius:12px" />
                </div>`;
                iframeRef.current?.contentWindow?.postMessage(
                  { event: 'setContent', payload: pdfHtml },
                  '*',
                );
                respond(requestId, true);
                break;
              }
              case 'code': {
                const [source, language] = args as [string, string?];
                const escaped = source
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const codeHtml = `<div class="pk-card">
                  ${language ? `<div style="margin-bottom:8px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase">${language}</div>` : ''}
                  <pre style="background:var(--muted,#f4f4f5);padding:16px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.6;font-family:'SF Mono',Menlo,monospace"><code>${escaped}</code></pre>
                </div>`;
                iframeRef.current?.contentWindow?.postMessage(
                  { event: 'setContent', payload: codeHtml },
                  '*',
                );
                respond(requestId, true);
                break;
              }
              default:
                respond(requestId, false, undefined, `未知 preview 方法: ${method}`);
                break;
            }
            return;
          }

          // ── file (文件系统) ──
          case 'file': {
            switch (method) {
              case 'pickOpen': {
                if (!hasPermission('file.read')) {
                  respond(requestId, false, undefined, '缺少权限: file.read');
                  return;
                }
                const [options] = args as [{ accept?: string; multiple?: boolean }?];
                // 通过 Electron dialog 打开文件
                const api = (window as any).electronAPI;
                if (!api?.pickFile) {
                  // fallback: 使用 HTML input
                  respond(requestId, false, undefined, '文件选择仅在 Electron 环境下可用');
                  return;
                }
                api.pickFile(options ?? {})
                  .then((result: unknown) => respond(requestId, true, result))
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return;
              }
              case 'pickSave': {
                if (!hasPermission('file.write')) {
                  respond(requestId, false, undefined, '缺少权限: file.write');
                  return;
                }
                const [content, defaultName] = args as [string, string?];
                const api = (window as any).electronAPI;
                if (!api?.saveFile) {
                  respond(requestId, false, undefined, '文件保存仅在 Electron 环境下可用');
                  return;
                }
                api.saveFile(content, defaultName ?? 'untitled.txt')
                  .then(() => respond(requestId, true))
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return;
              }
              default:
                respond(requestId, false, undefined, `未知 file 方法: ${method}`);
                break;
            }
            return;
          }

          // ── config (插件配置) ──
          case 'config': {
            const rawStore = pluginStorage.getConfig(pluginId);
            switch (method) {
              case 'get': {
                respond(requestId, true, rawStore[String(args[0])] ?? null);
                break;
              }
              case 'getAll': {
                respond(requestId, true, rawStore);
                break;
              }
              case 'set': {
                const key = String(args[0]);
                const value = args[1];
                pluginStorage.setConfig(pluginId, { ...rawStore, [key]: value });
                respond(requestId, true);
                break;
              }
              case 'getDefaults': {
                // 从插件清单中读取默认配置
                let defaults: Record<string, unknown> = {};
                try {
                  const defs = pluginStorage.loadDefinitions<Array<{ id: string; manifest?: { config?: Array<{ key: string; default?: unknown }> } }>[number]>();
                  const def = defs.find((d: any) => d.id === pluginId);
                  if (def?.manifest?.config) {
                    for (const c of def.manifest.config) {
                      if (c.default !== undefined) defaults[c.key] = c.default;
                    }
                  }
                } catch { /* ignore */ }
                respond(requestId, true, defaults);
                break;
              }
              default:
                respond(requestId, false, undefined, `未知 config 方法: ${method}`);
                break;
            }
            return;
          }

          default:
            respond(requestId, false, undefined, `未知 channel: ${channel}`);
            return;
        }
      } catch (err: any) {
        respond(requestId, false, undefined, err.message ?? String(err));
      }
    },
    [pluginId, permissions, respond],
  );

  // ── 监听 iframe 消息 ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!validateMessage(e.data)) return;
      const msg = e.data;
      // 只处理来自自己 iframe 的消息
      if (e.source !== iframeRef.current?.contentWindow) return;
      handleMessage(msg);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleMessage]);

  // ── onLoad: 注入 SDK 脚本 + 用户脚本 ──
  const onLoad = useCallback(() => {
    // 在 onLoad 外部由 PluginSandbox 通过 srcdoc 注入
  }, []);

  return {
    bridgeProps: {
      ref: iframeRef,
      onLoad,
    },
    postEvent,
  };
}
