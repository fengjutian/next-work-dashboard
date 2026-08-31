import type { RssHostApi, RssReaderAdapter } from '../react/adapter';

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriRssReaderOptions {
  invoke: TauriInvoke;
  /** Override command names when the Rust backend uses a different namespace. */
  commands?: Partial<Record<keyof RssHostApi['rss'] | 'openExternal' | 'pickFile' | 'saveFile', string>>;
  copyText?: (text: string) => void | Promise<void>;
}

const defaults = {
  fetch: 'rss_fetch', loadState: 'rss_load_state', saveState: 'rss_save_state', refreshAll: 'rss_refresh_all',
  setRefreshMinutes: 'rss_set_refresh_minutes', setRetentionDays: 'rss_set_retention_days',
  setNotificationsEnabled: 'rss_set_notifications_enabled', extractArticle: 'rss_extract_article', search: 'rss_search',
  listRules: 'rss_list_rules', saveRule: 'rss_save_rule', deleteRule: 'rss_delete_rule',
  openExternal: 'plugin:shell|open', pickFile: 'rss_pick_file', saveFile: 'rss_save_file',
} as const;

export function createTauriRssReaderAdapter(options: TauriRssReaderOptions): RssReaderAdapter {
  const command = { ...defaults, ...options.commands };
  const invoke = options.invoke;
  return { api: {
    rss: {
      fetch: (rawUrl) => invoke(command.fetch, { rawUrl }),
      loadState: () => invoke(command.loadState),
      saveState: (state) => invoke(command.saveState, { state }),
      refreshAll: () => invoke(command.refreshAll),
      setRefreshMinutes: (minutes) => invoke(command.setRefreshMinutes, { minutes }),
      setRetentionDays: (days) => invoke(command.setRetentionDays, { days }),
      setNotificationsEnabled: (enabled) => invoke(command.setNotificationsEnabled, { enabled }),
      extractArticle: (feedId, articleId, rawUrl) => invoke(command.extractArticle, { feedId, articleId, rawUrl }),
      search: (query) => invoke(command.search, { query }),
      listRules: () => invoke(command.listRules),
      saveRule: (rule) => invoke(command.saveRule, { rule }),
      deleteRule: (id) => invoke(command.deleteRule, { id }),
    },
    shell: { openExternal: (url) => invoke(command.openExternal, { path: url }) },
    copyText: (text) => { if (options.copyText) void options.copyText(text); else void globalThis.navigator.clipboard.writeText(text); },
    pickFile: (fileOptions) => invoke(command.pickFile, { options: fileOptions }),
    saveFile: (fileOptions) => invoke(command.saveFile, { options: fileOptions }),
  } };
}
