import type { ComponentType, FC } from 'react';

export type PluginDisposable = () => void;

export interface PluginContext {
  pluginId: string;
  /** Register cleanup work that runs automatically on disable or uninstall. */
  subscriptions: {
    add(disposable: PluginDisposable): void;
  };
  commands: {
    register(commandId: string, handler: (...args: unknown[]) => void | Promise<void>): PluginDisposable;
  };
}

// ── 命令定义 ──

export interface PluginCommand {
  /** 命令 ID，如 'myPlugin.doSomething' */
  id: string;
  /** 命令面板中显示的名称 */
  title: string;
  /** 可选分类 */
  category?: string;
}

// ── 状态栏项 ──

export interface StatusBarItemDef {
  id: string;
  text: string;
  tooltip?: string;
  /** 'left' | 'right'，默认 'right' */
  alignment?: 'left' | 'right';
  /** 排序权重，越小越靠左（left）或靠右（right） */
  priority?: number;
  /** 点击触发的命令 ID */
  command?: string;
}

// ── 插件贡献声明 ──

export interface PluginContributions {
  /** 插件提供的命令 */
  commands?: PluginCommand[];
  /** 状态栏项 */
  statusBarItems?: StatusBarItemDef[];
  /** 附加视图（key = viewId，用于未来扩展侧边栏/面板区域） */
  views?: Record<string, FC>;
}

/**
 * 插件接口 — 每个侧边栏面板必须实现此契约。
 *
 * ActivityBar 切换面板模式：
 *  - 插件注册后在 ActivityBar 显示一个图标按钮
 *  - 点击后主内容区渲染该插件的 component
 *  - 用户可在设置中启用/禁用插件
 */
export interface Plugin {
  /** 唯一标识，如 'ai', 'prompts', 'history', 'graph' */
  id: string;

  /** ActivityBar 悬停提示 & 设置页显示名 */
  name: string;

  /** 图标组件（用于 ActivityBar 按钮），通过统一图标出口提供 */
  icon: ComponentType<{ className?: string }>;

  /** 主面板 React 组件 */
  component: FC;

  /** 用户是否启用此插件 */
  enabled: boolean;

  /** ActivityBar 中的排序权重，越小越靠前 */
  order: number;

  /** 插件贡献声明（命令、状态栏项、附加视图等） */
  contributions?: PluginContributions;

  /** Called when an enabled plugin becomes active. */
  activate?: (context: PluginContext) => void | PluginDisposable | Promise<void | PluginDisposable>;

  /** Called after registered resources are disposed during disable/uninstall. */
  deactivate?: () => void | Promise<void>;
}
