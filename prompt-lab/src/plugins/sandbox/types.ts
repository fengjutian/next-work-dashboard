/**
 * Plugin Sandbox — 协议类型定义
 *
 * Host ↔ Sandbox 之间通过 postMessage 通信，
 * 所有消息遵循 Message 协议，按 channel 路由。
 */

// ── 应用数据快照类型 ──

export interface PromptSnapshot {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  isFavorite: boolean;
  isPinned: boolean;
  usageCount: number;
}

export interface SiteSnapshot {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface TabSnapshot {
  id: string;
  siteId: string;
  title: string;
  url: string;
}

export interface ConvMetaSnapshot {
  filePath: string;
  site: string;
  timestamp: number;
}

export interface ThemeTokens {
  /** CSS 变量集合，如 { '--foreground': '#09090b', '--background': '#ffffff', ... } */
  [key: string]: string;
}

// ── postMessage 协议 ──

/**
 * Host → Sandbox: 响应或事件推送
 * Sandbox → Host: 请求
 */
export interface SandboxMessage {
  /** 请求 ID（响应时原样返回） */
  requestId: string;
  /** API 通道: 'store' | 'ui' | 'actions' | 'data' */
  channel: Channel;
  /** 方法名，如 'getPrompts' | 'copyToClipboard' */
  method: string;
  /** 参数数组 */
  args?: unknown[];
  /** 仅响应: 是否成功 */
  ok?: boolean;
  /** 仅响应: 成功时的返回值 */
  result?: unknown;
  /** 仅响应: 失败时的错误信息 */
  error?: string;
  /** 事件推送: 事件名 */
  event?: string;
  /** 事件推送: 事件数据 */
  payload?: unknown;
}

export type Channel = 'store' | 'ui' | 'actions' | 'data';

// ── 插件权限 ──

export type PluginPermission =
  | 'store.read'       // 读取应用状态
  | 'clipboard'         // 读写剪贴板
  | 'inject'            // 向 AI 站点注入提示词
  | 'external.open'     // 在外部浏览器打开 URL
  | 'data'              // 插件私有存储 (localStorage 级别)
  ;

// ── 用户插件定义（完整版） ──

export interface UserPluginDef {
  id: string;
  name: string;
  description?: string;
  script: string;          // JavaScript 源码
  style?: string;          // 自定义 CSS
  permissions: PluginPermission[];
  /** emoji 图标，如 '📊' '⚡' */
  iconEmoji?: string;
}
