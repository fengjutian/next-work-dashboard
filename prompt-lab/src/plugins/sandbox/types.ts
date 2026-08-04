/**
 * Plugin Sandbox — 协议类型定义
 *
 * Host ↔ Sandbox 之间通过 postMessage 通信，
 * 所有消息遵循 Message 协议，按 channel 路由。
 *
 * ── 能力表 ──
 *
 *   channel    | method          | 权限            | 说明
 *   ───────────┼─────────────────┼────────────────┼──────────────────────────────
 *   store      | getPrompts      | store.read      | 获取所有提示词
 *   store      | getSites        | store.read      | 获取所有 AI 站点
 *   store      | getTabs         | store.read      | 获取所有标签页
 *   store      | getActiveTab    | store.read      | 获取当前活动标签页
 *   store      | getTheme        | store.read      | 获取当前主题 (light/dark/system)
 *   store      | getConversations| store.read      | 获取对话历史元数据列表
 *   store      | subscribe       | store.read      | 订阅状态变更事件
 *   ui         | setContent      | —               | 设置 iframe 内 HTML
 *   ui         | getThemeTokens  | —               | 获取 CSS 变量主题令牌
 *   ui         | showToast       | —               | 弹出通知
 *   ui         | getContainerSize| —               | 获取容器尺寸
 *   actions    | copyToClipboard | clipboard       | 复制文本到系统剪贴板
 *   actions    | injectPrompt    | inject          | 向 AI 站点注入提示词
 *   actions    | openUrl         | external.open   | 在外部浏览器打开 URL
 *   data       | get / set / del | data            | 插件私有键值存储
 *   data       | list            | data            | 列出所有私有存储 key
 *   preview    | markdown        | preview         | 渲染 Markdown 为 HTML
 *   preview    | image           | preview         | 显示图片预览
 *   preview    | pdf             | preview         | 显示 PDF 预览
 *   preview    | code            | preview         | 语法高亮代码展示
 *   file       | pickOpen        | file.read       | 打开文件选择对话框
 *   file       | pickSave        | file.write      | 保存文件对话框
 *   file       | read            | file.read       | 按路径读文件 (base64)
 *   config     | get             | —               | 读取插件配置项
 *   config     | getAll          | —               | 读取所有配置
 *   config     | set             | —               | 写入配置项
 *   config     | getDefaults     | —               | 读取 manifest 默认配置
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

export type Channel = 'store' | 'ui' | 'actions' | 'data' | 'preview' | 'file' | 'config';

// ── 插件权限 ──

export type PluginPermission =
  | 'store.read'       // 读取应用状态
  | 'clipboard'         // 读写剪贴板
  | 'inject'            // 向 AI 站点注入提示词
  | 'external.open'     // 在外部浏览器打开 URL
  | 'data'              // 插件私有存储 (localStorage 级别)
  | 'preview'           // 渲染预览 (pdf/图片/code/markdown)
  | 'file.read'         // 读取本地文件
  | 'file.write'        // 写入本地文件
  ;

// ── 文件操作类型 ──

export interface FilePickResult {
  path: string;
  name: string;
  size: number;
  content: string;  // base64
  mimeType: string;
}

// ── 用户插件定义（完整版） ──

/** 插件配置项声明 */
export interface PluginConfigDeclaration {
  /** 配置 key，建议用 pluginId 前缀如 'myPlugin.maxItems' */
  key: string;
  /** 显示标签 */
  label?: string;
  /** 描述 */
  description?: string;
  /** 类型，默认 'string' */
  type?: 'string' | 'number' | 'boolean';
  /** 默认值 */
  default?: string | number | boolean;
}

/** 插件清单（对应 .nwd 打包格式的 manifest.json） */
export interface PluginManifest {
  /** 稳定插件 ID；旧版插件缺失时会从 name 推导。 */
  id?: string;
  /** 与 package.json 对齐的扩展清单 */
  name: string;
  version: string;
  /** 宿主插件 API 版本，当前为 1。 */
  apiVersion?: string;
  description?: string;
  author?: string;
  /** emoji 图标 */
  iconEmoji?: string;
  /** 权限声明 */
  permissions: PluginPermission[];
  /** 配置项声明 */
  config?: PluginConfigDeclaration[];
  /** 激活事件（预留，当前不支持懒加载） */
  activationEvents?: string[];
  /** 运行时类型：iframe Sandbox；用户 Kernel 已移除。 */
  runtime?: 'sandbox';
}

export interface UserPluginDef {
  id: string;
  name: string;
  description?: string;
  script: string;          // JavaScript 源码（sandbox 模式）
  style?: string;          // 自定义 CSS
  permissions: PluginPermission[];
  /** emoji 图标，如 '📊' '⚡' */
  iconEmoji?: string;
  /** 插件清单（.nwd 格式迁移字段） */
  manifest?: PluginManifest;
}
