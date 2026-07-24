import type { ComponentType, FC } from 'react';

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

  /** lucide-react 图标组件（用于 ActivityBar 按钮） */
  icon: ComponentType<{ className?: string }>;

  /** 主面板 React 组件 */
  component: FC;

  /** 用户是否启用此插件 */
  enabled: boolean;

  /** ActivityBar 中的排序权重，越小越靠前 */
  order: number;
}
