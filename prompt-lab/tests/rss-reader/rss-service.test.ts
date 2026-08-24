import { describe, expect, it } from 'vitest';
import { discoverFeedUrl, privateAddress, rssRequestHeaders, ruleMatches } from '../../src/plugins/rss-reader/backend/rss-service';
import type { RssArticle, RssKeywordRule } from '../../src/plugins/rss-reader/types';

describe('RSS network helpers', () => {
  it('discovers relative RSS and Atom links from normal web pages', () => {
    expect(discoverFeedUrl('<html><head><link href="/feed.xml" rel="alternate" type="application/rss+xml"></head></html>', new URL('https://example.com/posts'))).toBe('https://example.com/feed.xml');
    expect(discoverFeedUrl("<link type='application/atom+xml' rel='alternate' href='atom.xml'>", new URL('https://example.com/blog/'))).toBe('https://example.com/blog/atom.xml');
  });

  it('ignores unrelated alternate links', () => {
    expect(discoverFeedUrl('<link rel="alternate" type="text/html" href="/print">', new URL('https://example.com'))).toBeNull();
  });

  it('recognizes private and special-use addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1']) expect(privateAddress(address)).toBe(true);
    expect(privateAddress('8.8.8.8')).toBe(false);
    expect(privateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('applies include and exclude keyword rules case-insensitively', () => {
    const article: RssArticle = { id: '1', feedId: 'feed', feedTitle: 'Tech', title: 'TypeScript Release', description: 'AI tooling update', author: 'OpenAI', link: '', publishedAt: null, read: false, starred: false };
    const rule: RssKeywordRule = { id: 'r1', name: 'AI', includeKeywords: ['typescript', 'rust'], excludeKeywords: ['sponsored'], action: 'star', enabled: true };
    expect(ruleMatches(article, rule)).toBe(true);
    expect(ruleMatches(article, { ...rule, excludeKeywords: ['TOOLING'] })).toBe(false);
    expect(ruleMatches(article, { ...rule, enabled: false })).toBe(false);
  });

  it('uses browser navigation headers for article extraction', () => {
    const headers = rssRequestHeaders('article');
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers.Accept).toContain('text/html');
    expect(headers['Accept-Language']).toContain('zh-CN');
    expect(rssRequestHeaders('feed').Accept).toContain('application/rss+xml');
  });
});
