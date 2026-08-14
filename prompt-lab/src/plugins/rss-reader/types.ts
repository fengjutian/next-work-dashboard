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
  error?: string;
}

export interface RssArticle extends RssFeedItem {
  feedId: string;
  feedTitle: string;
  read: boolean;
  starred: boolean;
}

