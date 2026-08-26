/**
 * IPC channel names used by `@next-work/rss-reader/main`.
 *
 * Exported as a constant table so the prompt-lab IPC contract checker
 * (which only scans `prompt-lab/src/`) can match these names without
 * having to walk into the package's compiled output.
 */

export const RSS_IPC = {
  FETCH: 'rss:fetch',
  STATE_LOAD: 'rss:state:load',
  STATE_SAVE: 'rss:state:save',
  REFRESH_ALL: 'rss:refresh:all',
  SETTINGS_REFRESH: 'rss:settings:refresh',
  SETTINGS_RETENTION: 'rss:settings:retention',
  SETTINGS_NOTIFICATIONS: 'rss:settings:notifications',
  ARTICLE_EXTRACT: 'rss:article:extract',
  SEARCH: 'rss:search',
  RULES_LIST: 'rss:rules:list',
  RULES_SAVE: 'rss:rules:save',
  RULES_DELETE: 'rss:rules:delete',
} as const;
