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

const DATA_PREFIX = 'pksdk:data:';

function getPluginStore(pluginId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + pluginId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setPluginStore(pluginId: string, store: Record<string, unknown>): void {
  localStorage.setItem(DATA_PREFIX + pluginId, JSON.stringify(store));
}

export function usePluginBridge({
  pluginId,
  permissions,
}: UsePluginBridgeOptions): UsePluginBridgeReturn {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
            if (!permissions.includes('store.read')) {
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
              case 'setContent': {
                const html = String(args[0] ?? '');
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
                const message = String(args[0] ?? '');
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
                if (!permissions.includes('clipboard')) {
                  respond(requestId, false, undefined, '缺少权限: clipboard');
                  return;
                }
                const text = String(args[0] ?? '');
                (window as any).electronAPI
                  ?.copyText(text)
                  .then(() => respond(requestId, true))
                  .catch((e: Error) => respond(requestId, false, undefined, e.message));
                return;
              }
              case 'injectPrompt': {
                if (!permissions.includes('inject')) {
                  respond(requestId, false, undefined, '缺少权限: inject');
                  return;
                }
                const [siteId, text, autoSubmit] = args as [string, string, boolean?];
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
                if (!permissions.includes('external.open')) {
                  respond(requestId, false, undefined, '缺少权限: external.open');
                  return;
                }
                const url = String(args[0] ?? '');
                window.open(url, '_blank', 'noopener,noreferrer');
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
            if (!permissions.includes('data')) {
              respond(requestId, false, undefined, '缺少权限: data');
              return;
            }
            const store = getPluginStore(pluginId);
            switch (method) {
              case 'get':
                respond(requestId, true, store[String(args[0])]);
                break;
              case 'set': {
                const key = String(args[0]);
                store[key] = args[1];
                setPluginStore(pluginId, store);
                respond(requestId, true);
                break;
              }
              case 'delete': {
                delete store[String(args[0])];
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
      const msg = e.data as SandboxMessage;
      if (!msg?.requestId || !msg?.channel) return;
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
