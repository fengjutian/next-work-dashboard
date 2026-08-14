import { describe, expect, it } from 'vitest';
import { discoverFeedUrl, privateAddress } from '../../src/plugins/rss-reader/backend/rss-service';

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
});
