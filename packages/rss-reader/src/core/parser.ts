import crypto from 'node:crypto';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { RssFeed, RssFeedItem } from './types';

function text(element: XmlElement | null, ...names: string[]): string {
  if (!element) return '';
  for (const name of names) {
    const nodes = element.getElementsByTagName(name);
    const value = nodes.item(0)?.textContent?.trim();
    if (value) return value;
  }
  return '';
}

function directElements(parent: XmlElement, name: string): XmlElement[] {
  return Array.from(parent.childNodes)
    .filter((node): node is XmlElement => node.nodeType === 1 && (node as XmlElement).tagName.toLowerCase() === name);
}

function atomLink(element: XmlElement): string {
  const links = Array.from(element.getElementsByTagName('link'));
  const preferred = links.find((node) => !node.getAttribute('rel') || node.getAttribute('rel') === 'alternate') ?? links[0];
  return preferred?.getAttribute('href')?.trim() ?? preferred?.textContent?.trim() ?? '';
}

function cleanMarkup(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function itemId(link: string, guid: string, title: string): string {
  return crypto.createHash('sha256').update(guid || link || title).digest('hex').slice(0, 24);
}

export function parseRssFeed(xml: string, feedUrl: string): RssFeed {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('订阅源 XML 格式无效');
  const rssChannel = document.getElementsByTagName('channel').item(0);
  const atomFeed = document.getElementsByTagName('feed').item(0);
  const root = rssChannel ?? atomFeed;
  if (!root) throw new Error('未识别到 RSS 或 Atom 订阅源');
  const isAtom = !rssChannel;
  const entries = isAtom ? directElements(root, 'entry') : directElements(root, 'item');
  const items: RssFeedItem[] = entries.map((entry) => {
    const title = text(entry, 'title') || '无标题';
    const link = isAtom ? atomLink(entry) : text(entry, 'link');
    const guid = text(entry, 'guid', 'id');
    return {
      id: itemId(link, guid, title),
      title,
      link,
      description: cleanMarkup(text(entry, 'content:encoded', 'content', 'description', 'summary')),
      author: text(entry, 'dc:creator', 'author', 'creator'),
      publishedAt: text(entry, 'pubDate', 'published', 'updated', 'date') || null,
    };
  });
  return {
    title: text(root, 'title') || new URL(feedUrl).hostname,
    description: cleanMarkup(text(root, 'description', 'subtitle')),
    siteUrl: isAtom ? atomLink(root) : text(root, 'link'),
    feedUrl,
    items,
  };
}
