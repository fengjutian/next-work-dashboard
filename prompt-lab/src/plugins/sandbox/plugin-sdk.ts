/**
 * PluginSDK — 注入到 iframe 沙箱中的运行时库。
 *
 * 提供 Promise 化的 API，底层通过 postMessage 与 Host Bridge 通信。
 * 用户脚本通过 window.PluginSDK 访问所有 API。
 *
 * 安全设计：
 *  - 所有调用序列化为 postMessage，不暴露 Host 对象引用
 *  - 订阅机制通过事件推送实现，iframe 侧只持有 listener 列表
 */

import type { SandboxMessage } from './types';

type Listener = (payload: unknown) => void;

// ── 请求/响应引擎 ──

function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 发送请求到 Host，返回 Promise */
function request<T = unknown>(
  channel: string,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId();
    const handler = (e: MessageEvent) => {
      const msg = e.data as SandboxMessage;
      if (msg?.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      if (msg.ok) resolve(msg.result as T);
      else reject(new Error(msg.error ?? 'Unknown error'));
    };
    window.addEventListener('message', handler);
    const req: SandboxMessage = { requestId, channel: channel as SandboxMessage['channel'], method, args };
    window.parent.postMessage(req, '*');
  });
}

// ── 事件订阅引擎 ──

const listeners = new Map<string, Set<Listener>>();

window.addEventListener('message', (e) => {
  const msg = e.data as SandboxMessage;
  if (!msg?.event) return;
  const set = listeners.get(msg.event);
  if (set) set.forEach((fn) => fn(msg.payload));
});

function subscribe(event: string, fn: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => {
    listeners.get(event)?.delete(fn);
  };
}

// ── PluginSDK 对象 ──

export interface PluginSDK {
  store: {
    getPrompts(): Promise<unknown[]>;
    getSites(): Promise<unknown[]>;
    getTabs(): Promise<unknown[]>;
    getActiveTab(): Promise<unknown | null>;
    getTheme(): Promise<string>;
    getConversations(): Promise<unknown[]>;
    subscribe(event: string, fn: Listener): () => void;
  };
  /** @deprecated 使用 store.subscribe 代替 */
  on: (event: string, fn: Listener) => () => void;

  ui: {
    setContent(html: string): Promise<void>;
    getThemeTokens(): Promise<Record<string, string>>;
    showToast(message: string, type?: string): Promise<void>;
    getContainerSize(): Promise<{ w: number; h: number }>;
  };

  actions: {
    copyToClipboard(text: string): Promise<void>;
    injectPrompt(siteId: string, text: string, autoSubmit?: boolean): Promise<void>;
    openUrl(url: string): Promise<void>;
  };

  data: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
  };

  /** 内容预览：PDF / 图片 / Markdown / 代码 */
  preview: {
    /** 渲染 Markdown 为 HTML */
    markdown(content: string): Promise<void>;
    /** 显示图片预览 (base64 或 URL) */
    image(src: string, alt?: string): Promise<void>;
    /** 显示 PDF 预览 (base64 或 URL) */
    pdf(src: string): Promise<void>;
    /** 语法高亮代码展示 */
    code(source: string, language?: string): Promise<void>;
  };

  /** 文件系统操作（需 file.read / file.write 权限） */
  file: {
    /** 打开文件选择对话框，返回文件内容 */
    pickOpen(options?: { accept?: string; multiple?: boolean }): Promise<unknown>;
    /** 保存文件对话框 */
    pickSave(content: string, defaultName?: string): Promise<void>;
  };
}

// ── 构建 SDK 实例 ──

const sdk: PluginSDK = {
  store: {
    getPrompts: () => request('store', 'getPrompts'),
    getSites: () => request('store', 'getSites'),
    getTabs: () => request('store', 'getTabs'),
    getActiveTab: () => request('store', 'getActiveTab'),
    getTheme: () => request('store', 'getTheme'),
    getConversations: () => request('store', 'getConversations'),
    subscribe,
  },
  on: subscribe,

  ui: {
    setContent: (html: string) => request('ui', 'setContent', [html]),
    getThemeTokens: () => request('ui', 'getThemeTokens'),
    showToast: (message, type = 'info') =>
      request('ui', 'showToast', [message, type]),
    getContainerSize: () => request('ui', 'getContainerSize'),
  },

  actions: {
    copyToClipboard: (text: string) =>
      request('actions', 'copyToClipboard', [text]),
    injectPrompt: (siteId, text, autoSubmit = false) =>
      request('actions', 'injectPrompt', [siteId, text, autoSubmit]),
    openUrl: (url: string) => request('actions', 'openUrl', [url]),
  },

  data: {
    get: (key: string) => request('data', 'get', [key]),
    set: (key, value) => request('data', 'set', [key, value]),
    delete: (key: string) => request('data', 'delete', [key]),
    list: () => request('data', 'list'),
  },

  preview: {
    markdown: (content: string) => request('preview', 'markdown', [content]),
    image: (src: string, alt?: string) => request('preview', 'image', [src, alt]),
    pdf: (src: string) => request('preview', 'pdf', [src]),
    code: (source: string, language?: string) => request('preview', 'code', [source, language]),
  },

  file: {
    pickOpen: (options) => request('file', 'pickOpen', [options]),
    pickSave: (content, defaultName) => request('file', 'pickSave', [content, defaultName]),
  },
};

export default sdk;
