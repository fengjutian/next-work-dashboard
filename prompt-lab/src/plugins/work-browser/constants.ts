/**
 * Work Browser 插件常量
 */
export const PLUGIN_ID = 'work-browser';
export const PLUGIN_NAME = 'Work Browser';
export const PLUGIN_ORDER = 9; // 在 markdown-editor 之后

export const STORAGE_KEYS = {
  AI_BASE_URL: 'workBrowser.ai.baseUrl',
  AI_API_KEY: 'workBrowser.ai.apiKey',
  AI_MODEL: 'workBrowser.ai.model',
  CLEANER_OPTIONS: 'workBrowser.cleaner.options',
  LAST_WORKSPACE: 'workBrowser.lastWorkspace',
  LEFT_SIDEBAR_COLLAPSED: 'workBrowser.layout.leftCollapsed',
  RIGHT_SIDEBAR_COLLAPSED: 'workBrowser.layout.rightCollapsed',
} as const;
