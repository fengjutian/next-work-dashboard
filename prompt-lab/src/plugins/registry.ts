import type { Plugin } from './types';

/**
 * PluginRegistry — 全局插件注册中心。
 *
 * 使用方式：
 *   1. 启动时调用 register() 注册所有内置插件
 *   2. ActivityBar 调用 getAll() / getEnabled() 渲染图标
 *   3. App.tsx 调用 getEnabled() 动态渲染面板
 */
type Listener = () => void;

class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private listeners = new Set<Listener>();

  /** 订阅变更通知（用于 React 组件触发重渲染） */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** 注册一个插件（id 重复则覆盖） */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] 覆盖已注册插件: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, { ...plugin });
    this.notify();
  }

  /** 批量注册 */
  registerAll(plugins: Plugin[]): void {
    for (const p of plugins) this.register(p);
  }

  /** 卸载插件 */
  unregister(id: string): boolean {
    const ok = this.plugins.delete(id);
    if (ok) this.notify();
    return ok;
  }

  /** 获取单个插件 */
  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  /** 获取所有插件（按 order 排序） */
  getAll(): Plugin[] {
    return [...this.plugins.values()].sort((a, b) => a.order - b.order);
  }

  /** 获取已启用的插件（按 order 排序） */
  getEnabled(): Plugin[] {
    return this.getAll().filter((p) => p.enabled);
  }

  /** 设置插件启用状态 */
  setEnabled(id: string, enabled: boolean): void {
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.enabled = enabled;
      this.notify();
    }
  }

  /** 批量设置启用状态 */
  setEnabledMap(map: Record<string, boolean>): void {
    for (const [id, enabled] of Object.entries(map)) {
      const p = this.plugins.get(id);
      if (p) p.enabled = enabled;
    }
    this.notify();
  }

  /** 获取所有插件的启用状态快照（用于持久化） */
  getEnabledSnapshot(): Record<string, boolean> {
    const snap: Record<string, boolean> = {};
    for (const p of this.plugins.values()) {
      snap[p.id] = p.enabled;
    }
    return snap;
  }
}

/** 全局单例 */
export const pluginRegistry = new PluginRegistry();
