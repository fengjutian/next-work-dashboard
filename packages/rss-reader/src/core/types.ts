export interface RssFeed {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  items: RssFeedItem[];
}

export interface RssFeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  author: string;
  publishedAt: string | null;
}

export interface RssSubscription extends Omit<RssFeed, 'items'> {
  id: string;
  addedAt: number;
  lastFetchedAt: number;
  category: string;
  /** 用户最初输入的地址；自动发现或重定向后仍保留。 */
  sourceUrl: string;
  error?: string;
}

export interface RssArticle extends RssFeedItem {
  feedId: string;
  feedTitle: string;
  read: boolean;
  starred: boolean;
}

export type RssRuleAction = 'notify' | 'star' | 'mark-read';
export interface RssKeywordRule {
  id: string;
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  action: RssRuleAction;
  enabled: boolean;
}

export interface RssState {
  subscriptions: RssSubscription[];
  articles: RssArticle[];
}
