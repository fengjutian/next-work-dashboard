export { pluginRegistry } from './registry';
export type { CommandHandler } from './registry';
export type { Plugin, PluginCommand, StatusBarItemDef, PluginContributions, PluginContext, PluginDisposable, PluginViewDef, PluginMenuItemDef, PluginSettingDef, PluginFileEditorDef } from './types';
export { registerBuiltInPlugins } from './built-in';
export { rehydrateUserPlugins } from './plugin-manager/user-plugin-store';
export { usePluginRegistryVersion } from './usePluginRegistry';
