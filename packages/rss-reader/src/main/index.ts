export { RSS_IPC } from './channels';
export type { RssMainAdapter, RssHttpCache } from './database';
export {
  getRssHttpCache,
  saveRssHttpCache,
  getRssRefreshMinutes,
  setRssRefreshMinutes,
  getRssRetentionDays,
  setRssRetentionDays,
  pruneRssArticles,
  getRssNotificationsEnabled,
  setRssNotificationsEnabled,
  saveRssArticleContent,
  getRssArticleContent,
  searchRssArticles,
  listRssRules,
  saveRssRule,
  deleteRssRule,
  loadRssState,
  saveRssState,
} from './database';
export type { RssMainFullAdapter, RssIpcDeps } from './service';
export {
  rssRequestHeaders,
  privateAddress,
  discoverFeedUrl,
  ruleMatches,
  startRssBackgroundRefresh,
  registerRssIpc,
} from './service';
