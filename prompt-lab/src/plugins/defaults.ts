export const EXCEL_PREVIEW_DEFAULT_ENABLED = false;

const DEFAULT_DISABLED_USER_PLUGIN_NAMES = new Set(['今日待办']);

export function getUserPluginDefaultEnabled(def: { name: string; enabled?: boolean }): boolean {
  return def.enabled ?? !DEFAULT_DISABLED_USER_PLUGIN_NAMES.has(def.name.trim());
}
