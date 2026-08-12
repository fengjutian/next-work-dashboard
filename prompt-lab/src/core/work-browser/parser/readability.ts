/**
 * Readability 风格正文提取
 *
 * 不引入 @mozilla/readability（依赖 JSDOM，对纯函数不友好）。
 * 这里实现"启发式 + 标签评分"版本：
 *  - 去除明显非正文容器（nav/header/footer/aside/script/style/noscript）
 *  - 段落评分：包含 <p>/<article> 加分；纯链接列表减分
 *  - 取评分最高的容器作为正文，输出 Markdown
 */
import { htmlToMarkdownInline } from './markdown';

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'object', 'embed',
  'nav', 'header', 'footer', 'aside', 'form', 'button',
  '[aria-hidden="true"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
];

const POSITIVE_HINTS = ['article', 'main', 'content', 'post', 'story', 'entry', 'body', 'markdown-body'];
const NEGATIVE_HINTS = ['comment', 'sidebar', 'footer', 'header', 'nav', 'ad', 'meta', 'share', 'related', 'recommend'];

/**
 * 简化的 DOM 接口 — 接受 jsdom 或自实现的最小子集。
 */
export interface DomLike {
  querySelectorAll(sel: string): DomLike[];
  querySelector(sel: string): DomLike | null;
  getElementsByTagName(tag: string): DomLike[];
  textContent: string | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
  tagName: string;
  childNodes: DomLike[];
  parentNode: DomLike | null;
  removeChild(child: DomLike): void;
}

interface ScoredNode {
  node: DomLike | null;
  score: number;
  textLength: number;
}

function score(node: DomLike): ScoredNode {
  if (!node || !node.textContent) return { node, score: 0, textLength: 0 };
  const text = String(node.textContent || '');
  const textLength = text.length;
  if (textLength < 50) return { node, score: 0, textLength };

  let s = textLength / 100; // 基础分
  const tag = (node.tagName || '').toLowerCase();
  if (tag === 'article' || tag === 'main') s += 25;
  if (tag === 'p') s += 5;
  if (tag === 'section' || tag === 'div') s += 2;

  const cls = (node.getAttribute('class') || '').toLowerCase();
  const id = (node.getAttribute('id') || '').toLowerCase();
  const signature = `${cls} ${id}`;
  for (const hint of POSITIVE_HINTS) if (signature.includes(hint)) s += 15;
  for (const hint of NEGATIVE_HINTS) if (signature.includes(hint)) s -= 20;

  const links = node.getElementsByTagName('a').length;
  if (links > 0) {
    const linkDensity = links / Math.max(textLength / 50, 1);
    if (linkDensity > 0.5) s -= 10;
  }

  const paragraphs = node.getElementsByTagName('p').length;
  s += paragraphs * 2;

  return { node, score: s, textLength };
}

function pickTopContainer(root: DomLike): DomLike {
  const candidates: DomLike[] = [];
  const collect = (el: DomLike | null) => {
    if (!el) return;
    if (el.tagName) {
      const tag = el.tagName.toLowerCase();
      if (['p', 'article', 'section', 'main', 'div'].includes(tag)) candidates.push(el);
    }
    for (let i = 0; i < (el.childNodes?.length || 0); i++) collect(el.childNodes[i]);
  };
  collect(root);
  let best: ScoredNode = { node: null, score: -Infinity, textLength: 0 };
  for (const c of candidates) {
    const s = score(c);
    if (s.score > best.score) best = s;
  }
  return best.node || root;
}

export interface ReadabilityResult {
  title: string;
  author: string | null;
  publishedAt: number | null;
  contentMarkdown: string;
  contentText: string;
  excerpt: string;
  wordCount: number;
  images: string[];
  links: { href: string; text: string }[];
}

export function extractReadabilityFromDom(dom: DomLike): ReadabilityResult {
  for (const sel of STRIP_SELECTORS) {
    const nodes = dom.querySelectorAll(sel);
    for (const n of nodes) {
      if (n?.parentNode) n.parentNode.removeChild(n);
    }
  }

  const titleNode = dom.querySelector('title') || dom.querySelector('h1');
  const title = (titleNode?.textContent || '').trim();

  const authorNode =
    dom.querySelector('meta[name="author"]') ||
    dom.querySelector('meta[property="article:author"]') ||
    dom.querySelector('[rel="author"]');
  const author = authorNode?.getAttribute('content') || authorNode?.textContent?.trim() || null;

  const dateNode =
    dom.querySelector('meta[property="article:published_time"]') ||
    dom.querySelector('meta[name="pubdate"]') ||
    dom.querySelector('time[datetime]');
  const publishedAt = dateNode
    ? Date.parse(
        dateNode.getAttribute('content') ||
        dateNode.getAttribute('datetime') ||
        dateNode.textContent ||
        '',
      ) || null
    : null;

  const top = pickTopContainer(dom);
  const contentText = (top.textContent || '').replace(/[ \t]+\n/g, '\n').trim();
  const wordCount = contentText.split(/\s+/).filter(Boolean).length;

  const images: string[] = [];
  const links: { href: string; text: string }[] = [];
  for (const img of top.getElementsByTagName('img')) {
    const src = img.getAttribute('src');
    if (src) {
      try { images.push(new URL(src, 'https://invalid.local/').toString()); } catch { images.push(src); }
    }
  }
  for (const a of top.getElementsByTagName('a')) {
    const href = a.getAttribute('href');
    const text = (a.textContent || '').trim();
    if (href && text) {
      try { links.push({ href: new URL(href, 'https://invalid.local/').toString(), text }); }
      catch { links.push({ href, text }); }
    }
  }

  return {
    title,
    author,
    publishedAt: publishedAt && Number.isFinite(publishedAt) ? publishedAt : null,
    contentMarkdown: htmlToMarkdownInline(top.innerHTML || ''),
    contentText,
    excerpt: contentText.slice(0, 200).replace(/\s+/g, ' '),
    wordCount,
    images,
    links,
  };
}

/**
 * 便捷入口：传入 HTML 字符串并用 jsdom 构造标准 DOM。
 * 主要在 main 端用，测试里直接传 DomLike。
 */
export async function extractReadability(html: string): Promise<ReadabilityResult> {
  // @xmldom/xmldom only implements the XML DOM API and does not provide
  // querySelector/querySelectorAll. The extractor relies on CSS selectors,
  // therefore it must use an HTML DOM implementation here.
  const { JSDOM } = await import('jsdom');
  const doc = new JSDOM(html).window.document as unknown as DomLike;
  return extractReadabilityFromDom(doc);
}
