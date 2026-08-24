/**
 * HTML Cleaner — 选择器 + CSS + JS 注入
 */
import { describe, it, expect } from 'vitest';
import { extractReadability, htmlClean } from '@/core/work-browser/parser';
import { DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '@/core/work-browser/types';

describe('htmlClean', () => {
  it('默认选项会包含 cookie banner / ads / popups 选择器', () => {
    const out = htmlClean(DEFAULT_CLEAN_OPTIONS);
    expect(out.css).toContain('display: none');
    expect(out.blockedSelectors.some((s) => s.includes('cookie'))).toBe(true);
    expect(out.blockedSelectors.some((s) => s.includes('modal') || s.includes('popup'))).toBe(true);
    expect(out.blockedSelectors.some((s) => s.includes('ad'))).toBe(true);
    expect(out.blockedDomains).toContain('doubleclick.net');
  });

  it('关闭 removeAds 时不再输出广告选择器', () => {
    const opts: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS, removeAds: false };
    const out = htmlClean(opts);
    expect(out.blockedSelectors.every((s) => !/^[.[]/.test(s) || s.includes('ad') === false)).toBe(true);
    // cookie banner 仍存在
    expect(out.blockedSelectors.some((s) => s.includes('cookie'))).toBe(true);
  });

  it('customSelectors 与内置合并', () => {
    const out = htmlClean({ ...DEFAULT_CLEAN_OPTIONS, customSelectors: ['#my-newsletter'] });
    expect(out.blockedSelectors).toContain('#my-newsletter');
  });

  it('blockDomains 与内置合并去重', () => {
    const out = htmlClean({ ...DEFAULT_CLEAN_OPTIONS, blockDomains: ['example.com', 'doubleclick.net'] });
    const count = out.blockedDomains.filter((d) => d === 'doubleclick.net').length;
    expect(count).toBe(1);
    expect(out.blockedDomains).toContain('example.com');
  });

  it('blockMediaAutoplay=true 时 css 含 video/audio 规则', () => {
    const out = htmlClean(DEFAULT_CLEAN_OPTIONS);
    expect(out.css).toMatch(/video/);
  });

  it('JS 注入幂等（防重复注入）', () => {
    const out = htmlClean(DEFAULT_CLEAN_OPTIONS);
    expect(out.js).toContain('__workBrowserCleaner');
  });
});

describe('extractReadability', () => {
  it('parses HTML with CSS selectors and removes non-content elements', async () => {
    const result = await extractReadability(`<!doctype html><html><head>
      <title>Saved article</title><meta name="author" content="Alice">
      </head><body><nav>Navigation</nav><article class="story-content">
      <h1>Saved article</h1><p>This is the main article paragraph with enough useful text to be selected as readable content.</p>
      <p>A second paragraph makes the extracted article stable and representative.</p>
      </article><script>window.bad = true</script></body></html>`);

    expect(result.title).toBe('Saved article');
    expect(result.author).toBe('Alice');
    expect(result.contentText).toContain('main article paragraph');
    expect(result.contentText).not.toContain('Navigation');
  });

  it('preserves paragraph and heading boundaries when elements have attributes', async () => {
    const result = await extractReadability(`<article class="story-content">
      <h2 class="article-heading">Safety first</h2>
      <p class="article-copy">First paragraph has enough text to form readable article content without being joined.</p>
      <p data-section="two">Second paragraph stays separate from the first paragraph in Markdown output.</p>
    </article>`);

    expect(result.contentMarkdown).toContain('## Safety first');
    expect(result.contentMarkdown).toContain('content without being joined.\n\nSecond paragraph');
  });
});
