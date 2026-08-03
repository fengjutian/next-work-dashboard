import React from 'react';
import { Blocks } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DynamicPlugin } from '../dynamic';
import type { PluginPermission, PluginManifest } from '../sandbox/types';
import { getUserPluginDefaultEnabled } from '../defaults';

// ── localStorage 持久化 ──

const STORAGE_KEY = 'plugin-manager-user-plugins';

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUserPlugins(defs: UserPluginDef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defs));
}

/** 重新注册所有用户插件（启动时调用，幂等） */
export function rehydrateUserPlugins(): void {
  const defs = loadUserPlugins();
  const nextOrder = pluginRegistry.getAll().length;
  defs.forEach((def, i) => {
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
    pluginRegistry.register({
      id: def.id,
      name: def.name,
      icon: Blocks,
      component: BoundPlugin,
      enabled: getUserPluginDefaultEnabled(def),
      order: nextOrder + i,
      contributions: { commands },
    });
  });
}

/** 注册单个用户插件（用于新建/导入后即时注册） */
export function registerUserPlugin(def: UserPluginDef): void {
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
  pluginRegistry.register({
    id: def.id,
    name: def.name,
    icon: Blocks,
    component: BoundPlugin,
    enabled: getUserPluginDefaultEnabled(def),
    order: pluginRegistry.getAll().length,
    contributions: { commands },
  });
}
