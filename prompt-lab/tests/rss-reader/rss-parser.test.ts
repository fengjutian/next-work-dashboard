import { describe, expect, it } from 'vitest';
import { parseRssFeed } from '../../src/plugins/rss-reader/backend/rss-parser';

describe('parseRssFeed', () => {
  it('parses RSS 2.0 and removes markup from descriptions', () => {
    const feed = parseRssFeed(`<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Example News</title><link>https://example.com</link><description>Latest</description>
      <item><title>First story</title><link>https://example.com/1</link><guid>story-1</guid>
      <description><![CDATA[<p>Hello <strong>world</strong></p>]]></description><pubDate>Fri, 14 Aug 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`, 'https://example.com/feed.xml');
    expect(feed.title).toBe('Example News');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ title: 'First story', link: 'https://example.com/1', description: 'Hello world' });
  });

  it('parses Atom links and summaries', () => {
    const feed = parseRssFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
      <link href="https://example.org"/><entry><id>entry-1</id><title>An entry</title>
      <link rel="alternate" href="https://example.org/entry"/><summary>Summary</summary><updated>2026-08-14T10:00:00Z</updated></entry></feed>`, 'https://example.org/atom.xml');
    expect(feed.siteUrl).toBe('https://example.org');
    expect(feed.items[0]).toMatchObject({ title: 'An entry', link: 'https://example.org/entry', description: 'Summary' });
  });

  it('rejects documents that are not feeds', () => {
    expect(() => parseRssFeed('<html><body>no feed</body></html>', 'https://example.com')).toThrow('未识别');
  });
});
