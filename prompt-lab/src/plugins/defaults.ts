export const EXCEL_PREVIEW_DEFAULT_ENABLED = false;

const DEFAULT_DISABLED_USER_PLUGIN_NAMES = new Set(['今日待办', 'excel 阅读器']);

export function getUserPluginDefaultEnabled(def: { name: string; enabled?: boolean }): boolean {
  const normalizedName = def.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return def.enabled ?? !DEFAULT_DISABLED_USER_PLUGIN_NAMES.has(normalizedName);
}
