import React from 'react';
import { pluginRegistry } from '@/plugins';
import { pluginStorage } from '@/plugins/plugin-storage';
import { loadUserPlugins } from '@/plugins/plugin-manager/user-plugin-store';
import type { PluginPermission } from '@/plugins/sandbox/types';

const PERMISSION_LABELS: Record<PluginPermission, string> = {
  'store.read': '读取工作数据',
  clipboard: '访问剪贴板',
  inject: '向 AI 站点注入内容',
  'external.open': '打开外部链接',
  data: '读写插件私有数据',
  preview: '预览内容',
  'file.read': '读取文件',
  'file.write': '写入文件',
};

export const SettingsPlugins: React.FC = () => {
  const [, refresh] = React.useReducer((value) => value + 1, 0);
  const definitions = new Map(loadUserPlugins().map((definition) => [definition.id, definition]));
  const settings = pluginRegistry.getSettings();
  const configurablePlugins = pluginRegistry.getAll().filter((plugin) =>
    plugin.source === 'user' || settings.some((setting) => setting.pluginId === plugin.id),
  );

  if (!configurablePlugins.length) {
    return <p className="py-8 text-center text-xs text-muted-foreground">暂无可配置插件</p>;
  }

  return <div className="space-y-3">
    {configurablePlugins.map((plugin) => {
      const declaration = definitions.get(plugin.id);
      const declaredPermissions = declaration?.permissions ?? declaration?.manifest?.permissions ?? [];
      const grants = pluginStorage.getGrants(plugin.id);
      const config = pluginStorage.getConfig(plugin.id);
      const pluginSettings = settings.filter((setting) => setting.pluginId === plugin.id);
      return <section key={plugin.id} className="rounded-lg border border-border p-3">
        <div className="mb-3">
          <h4 className="text-sm font-medium text-foreground">{plugin.name}</h4>
          <code className="text-[10px] text-muted-foreground">{plugin.id}</code>
        </div>

        {pluginSettings.length > 0 && <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">设置</p>
          {pluginSettings.map((setting) => {
            const value = config[setting.key] ?? setting.default ?? (setting.type === 'boolean' ? false : '');
            const save = (next: unknown) => {
              pluginStorage.setConfig(plugin.id, { ...config, [setting.key]: next });
              refresh();
            };
            return <label key={setting.key} className="flex items-center justify-between gap-3 text-xs">
              <span title={setting.description}>{setting.label}</span>
              {setting.type === 'boolean' ? (
                <input type="checkbox" checked={Boolean(value)} onChange={(event) => save(event.target.checked)} />
              ) : (
                <input
                  className="w-40 rounded border border-input bg-background px-2 py-1"
                  type={setting.type === 'number' ? 'number' : 'text'}
                  value={String(value)}
                  onChange={(event) => save(setting.type === 'number' ? Number(event.target.value) : event.target.value)}
                />
              )}
            </label>;
          })}
        </div>}

        {declaredPermissions.length > 0 && <div className={`${pluginSettings.length ? 'mt-3 border-t pt-3' : ''} space-y-2`}>
          <p className="text-[11px] font-medium text-muted-foreground">权限</p>
          {declaredPermissions.map((permission) => <label key={permission} className="flex items-center justify-between gap-3 text-xs">
            <span>{PERMISSION_LABELS[permission]}</span>
            <input
              type="checkbox"
              checked={grants.includes(permission)}
              onChange={(event) => {
                pluginStorage.setGrants(plugin.id, event.target.checked
                  ? [...new Set([...grants, permission])]
                  : grants.filter((grant) => grant !== permission));
                refresh();
              }}
            />
          </label>)}
        </div>}
      </section>;
    })}
  </div>;
};
