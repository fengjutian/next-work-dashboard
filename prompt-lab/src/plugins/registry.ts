import type { Plugin, PluginCommand, PluginContext, PluginDisposable } from './types';
import { pluginStorage } from './plugin-storage';

export type PluginLifecycleState = 'inactive' | 'activating' | 'active' | 'deactivating' | 'error';

/**
 * PluginRegistry — 全局插件注册中心。
 *
 * 使用方式：
 *   1. 启动时调用 register() 注册所有内置插件
 *   2. ActivityBar 调用 getAll() / getEnabled() 渲染图标
 *   3. App.tsx 调用 getEnabled() 动态渲染面板
 *
 * 扩展：
 *   4. 命令系统：registerCommandHandler / executeCommand / getCommands
 *   5. 状态栏项：通过 Plugin.contributions.statusBarItems 声明
 */
type Listener = () => void;

/** 命令处理器签名 */
export type CommandHandler = (...args: unknown[]) => void | Promise<void>;

/** 已注册的命令（含关联插件信息） */
interface RegisteredCommand extends PluginCommand {
  /** 所属插件 ID */
  pluginId: string;
}

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private listeners = new Set<Listener>();
  private version = 0;
  private commands = new Map<string, RegisteredCommand>();
  private lifecycleStates = new Map<string, PluginLifecycleState>();
  private lifecycleTokens = new Map<string, number>();
  private pluginDisposables = new Map<string, Set<PluginDisposable>>();
  /** 命令执行器 — 由 App 层通过 registerCommandHandler 注入 */
  private commandHandlers = new Map<string, CommandHandler>();

  /** 订阅变更通知（用于 React 组件触发重渲染） */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Stable scalar snapshot for React.useSyncExternalStore. */
  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  getLifecycleState(id: string): PluginLifecycleState {
    return this.lifecycleStates.get(id) ?? 'inactive';
  }

  getViews() { return this.getEnabled().flatMap((plugin) => (plugin.contributions?.views ?? []).map((item) => ({ ...item, pluginId: plugin.id }))); }
  getMenus(location?: 'file' | 'modules' | 'view' | 'context') {
    return this.getEnabled().flatMap((plugin) => (plugin.contributions?.menus ?? []).map((item) => ({ ...item, pluginId: plugin.id })))
      .filter((item) => !location || item.location === location)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  getSettings() { return this.getEnabled().flatMap((plugin) => (plugin.contributions?.settings ?? []).map((item) => ({ ...item, pluginId: plugin.id }))); }
  resolveFileEditor(fileName: string) {
    const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (!extension) return undefined;
    return this.getEnabled().flatMap((plugin) => (plugin.contributions?.fileEditors ?? []).map((item) => ({ ...item, pluginId: plugin.id })))
      .filter((item) => item.extensions.map((value) => value.toLowerCase()).includes(extension))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  }

  setSafeMode(enabled: boolean): void {
    pluginStorage.setSafeMode(enabled);
    for (const plugin of this.plugins.values()) {
      if (plugin.source === 'user') this.setEnabled(plugin.id, !enabled && !pluginStorage.isCrashDisabled(plugin.id));
    }
  }

  private nextLifecycleToken(id: string): number {
    const token = (this.lifecycleTokens.get(id) ?? 0) + 1;
    this.lifecycleTokens.set(id, token);
    return token;
  }

  private disposePluginResources(id: string): void {
    const disposables = this.pluginDisposables.get(id);
    this.pluginDisposables.delete(id);
    if (!disposables) return;
    for (const dispose of [...disposables].reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[PluginRegistry] Failed to dispose resource for "${id}"`, error);
      }
    }
  }

  private async activatePlugin(plugin: Plugin): Promise<void> {
    if (!plugin.activate || !plugin.enabled) return;
    const token = this.nextLifecycleToken(plugin.id);
    const disposables = new Set<PluginDisposable>();
    this.pluginDisposables.set(plugin.id, disposables);
    this.lifecycleStates.set(plugin.id, 'activating');
    this.notify();

    const addDisposable = (disposable: PluginDisposable) => {
      if (this.lifecycleTokens.get(plugin.id) !== token) {
        disposable();
        return;
      }
      disposables.add(disposable);
    };
    const context: PluginContext = {
      pluginId: plugin.id,
      subscriptions: { add: addDisposable },
      commands: {
        register: (commandId, handler) => {
          const dispose = this.registerCommandHandler(commandId, handler);
          addDisposable(dispose);
          return dispose;
        },
      },
    };

    try {
      const disposable = await plugin.activate(context);
      if (typeof disposable === 'function') addDisposable(disposable);
      if (this.lifecycleTokens.get(plugin.id) !== token) return;
      this.lifecycleStates.set(plugin.id, 'active');
    } catch (error) {
      if (this.lifecycleTokens.get(plugin.id) !== token) return;
      this.disposePluginResources(plugin.id);
      this.lifecycleStates.set(plugin.id, 'error');
      pluginStorage.appendLog(plugin.id, { timestamp: Date.now(), level: 'error', message: error instanceof Error ? error.message : String(error) });
      if (plugin.source === 'user' && pluginStorage.recordCrash(plugin.id) >= 3) {
        this.setEnabled(plugin.id, false);
      }
      console.error(`[PluginRegistry] Failed to activate "${plugin.id}"`, error);
    }
    this.notify();
  }

  private async deactivatePlugin(plugin: Plugin): Promise<void> {
    const token = this.nextLifecycleToken(plugin.id);
    this.lifecycleStates.set(plugin.id, 'deactivating');
    this.disposePluginResources(plugin.id);
    this.notify();
    try {
      await plugin.deactivate?.();
    } catch (error) {
      console.error(`[PluginRegistry] Failed to deactivate "${plugin.id}"`, error);
    }
    if (this.lifecycleTokens.get(plugin.id) === token) {
      this.lifecycleStates.set(plugin.id, 'inactive');
      this.notify();
    }
  }

  /** 注册一个插件（id 重复则覆盖） */
  register(plugin: Plugin): void {
    const previous = this.plugins.get(plugin.id);
    if (previous) void this.deactivatePlugin(previous);
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] 覆盖已注册插件: ${plugin.id}`);
      // 卸载旧命令
      this.unregisterCommands(plugin.id);
    }
    this.plugins.set(plugin.id, { ...plugin });
    // 注册插件声明的命令
    if (plugin.contributions?.commands) {
      for (const cmd of plugin.contributions.commands) {
        this.commands.set(cmd.id, { ...cmd, pluginId: plugin.id });
      }
    }
    this.notify();
    if (plugin.enabled) void this.activatePlugin(this.plugins.get(plugin.id)!);
  }

  /** 批量注册 */
  registerAll(plugins: Plugin[]): void {
    for (const p of plugins) this.register(p);
  }

  /** 卸载插件及其命令 */
  unregister(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (plugin) void this.deactivatePlugin(plugin);
    this.unregisterCommands(id);
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
    if (plugin && plugin.enabled !== enabled) {
      this.plugins.set(id, { ...plugin, enabled });
      this.notify();
      if (enabled) void this.activatePlugin(this.plugins.get(id)!);
      else void this.deactivatePlugin(plugin);
    }
  }

  /** 批量设置启用状态 */
  setEnabledMap(map: Record<string, boolean>): void {
    let changed = false;
    for (const [id, enabled] of Object.entries(map)) {
      const p = this.plugins.get(id);
      if (p && p.enabled !== enabled) {
        this.plugins.set(id, { ...p, enabled });
        if (enabled) void this.activatePlugin(this.plugins.get(id)!);
        else void this.deactivatePlugin(p);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  /** 获取所有插件的启用状态快照（用于持久化） */
  getEnabledSnapshot(): Record<string, boolean> {
    const snap: Record<string, boolean> = {};
    for (const p of this.plugins.values()) {
      snap[p.id] = p.enabled;
    }
    return snap;
  }

  // ── 命令系统 ──

  /** 注册命令处理器（由 App 或插件面板注入） */
  registerCommandHandler(commandId: string, handler: CommandHandler): PluginDisposable {
    this.commandHandlers.set(commandId, handler);
    return () => {
      if (this.commandHandlers.get(commandId) === handler) {
        this.commandHandlers.delete(commandId);
      }
    };
  }

  /** 执行命令，返回 true 表示找到并执行了处理器 */
  executeCommand(commandId: string, ...args: unknown[]): boolean {
    const handler = this.commandHandlers.get(commandId);
    if (handler) {
      handler(...args);
      return true;
    }
    // 回退：如果命令有对应插件面板，激活面板作为默认行为
    const cmd = this.commands.get(commandId);
    if (cmd) {
      const plugin = this.plugins.get(cmd.pluginId);
      if (plugin?.enabled) {
        // 通知订阅者激活该插件（由 App 层处理）
        this.notify();
        return true;
      }
    }
    console.warn(`[PluginRegistry] 命令 "${commandId}" 未注册处理器`);
    return false;
  }

  /** 获取所有已注册命令 */
  getCommands(): RegisteredCommand[] {
    return [...this.commands.values()];
  }

  /** 获取指定插件提供的命令 */
  getPluginCommands(pluginId: string): RegisteredCommand[] {
    return this.getCommands().filter((c) => c.pluginId === pluginId);
  }

  /** 清理指定插件的所有命令 */
  private unregisterCommands(pluginId: string): void {
    for (const [cmdId, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) {
        this.commands.delete(cmdId);
        this.commandHandlers.delete(cmdId);
      }
    }
  }
}

/** 全局单例 */
export const pluginRegistry = new PluginRegistry();
