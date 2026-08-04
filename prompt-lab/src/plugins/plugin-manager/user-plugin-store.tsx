import React from 'react';
import { Blocks } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DynamicPlugin } from '../dynamic';
import type { PluginPermission, PluginManifest } from '../sandbox/types';
import { getUserPluginDefaultEnabled } from '../defaults';
import { pluginStorage } from '../plugin-storage';

// ── localStorage 持久化 ──

export interface UserPluginDef {
  id: string;
  name: string;
  content: string;
  script?: string;
  style?: string;
  permissions?: PluginPermission[];
  iconEmoji?: string;
  manifest?: PluginManifest;
  bundle?: string;
  /** 首次注册时的默认状态；用户持久化设置仍可覆盖。 */
  enabled?: boolean;
}

export function loadUserPlugins(): UserPluginDef[] {
  return pluginStorage.loadDefinitions<UserPluginDef>();
}

export function saveUserPlugins(defs: UserPluginDef[]): void {
  pluginStorage.saveDefinitions(defs);
}

/** 重新注册所有用户插件（启动时调用，幂等） */
export function rehydrateUserPlugins(): void {
  const defs = loadUserPlugins();
  const nextOrder = pluginRegistry.getAll().length;
  defs.forEach((def, i) => {
    if (def.manifest?.runtime === 'kernel' || def.bundle) return;
    if (pluginRegistry.get(def.id)) return;
    const BoundPlugin: React.FC = () => (
      <DynamicPlugin
        pluginName={def.name}
        content={def.content}
        script={def.script}
        style={def.style}
        pluginId={def.id}
        permissions={def.permissions}
        bundle={def.bundle}
      />
    );
    const commands = def.manifest?.config
      ? def.manifest.config.map((c) => ({
          id: `${def.id}.setConfig.${c.key}`,
          title: `设置 ${c.label ?? c.key}`,
          category: def.name,
        }))
      : undefined;
    const settings = def.manifest?.config?.map((item) => ({
      key: item.key, label: item.label ?? item.key, type: item.type ?? 'string',
      default: item.default, description: item.description,
    }));
    pluginRegistry.register({
      id: def.id,
      source: 'user',
      name: def.name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: !pluginStorage.isSafeMode() && !pluginStorage.isCrashDisabled(def.id) && getUserPluginDefaultEnabled(def),
      order: nextOrder + i,
      contributions: { commands, settings },
    });
  });
}

/** 注册单个用户插件（用于新建/导入后即时注册） */
export function registerUserPlugin(def: UserPluginDef): void {
  if (def.manifest?.runtime === 'kernel' || def.bundle) {
    throw new Error('User Kernel plugins are disabled');
  }
  const BoundPlugin: React.FC = () => (
    <DynamicPlugin
      pluginName={def.name}
      content={def.content}
      script={def.script}
      style={def.style}
      pluginId={def.id}
      permissions={def.permissions}
      bundle={def.bundle}
    />
  );
  const commands = def.manifest?.config
    ? def.manifest.config.map((c) => ({
        id: `${def.id}.setConfig.${c.key}`,
        title: `设置 ${c.label ?? c.key}`,
        category: def.name,
      }))
    : undefined;
  const settings = def.manifest?.config?.map((item) => ({
    key: item.key, label: item.label ?? item.key, type: item.type ?? 'string',
    default: item.default, description: item.description,
  }));
  pluginRegistry.register({
    id: def.id,
    source: 'user',
    name: def.name,
    icon: Blocks,
    component: BoundPlugin,
    enabled: !pluginStorage.isSafeMode() && !pluginStorage.isCrashDisabled(def.id) && getUserPluginDefaultEnabled(def),
    order: pluginRegistry.getAll().length,
    contributions: { commands, settings },
  });
}
