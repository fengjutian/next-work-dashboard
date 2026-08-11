/**
 * P2 打磨阶段单测：覆盖新提取的纯函数。
 *
 * - Wiki Link 解析：正则扫描、target/label 提取
 * - 已知问题：ProseMirror doc 集成需要 DOM 环境，跳过；纯函数已足够覆盖核心逻辑
 */

import { describe, expect, it } from 'vitest';
import { scanWikiLinksInText } from '../src/plugins/markdown-editor/editor/wiki-link-parser';

describe('scanWikiLinksInText', () => {
  it('returns empty array for no links', () => {
    expect(scanWikiLinksInText('plain text')).toEqual([]);
  });

  it('finds a simple link', () => {
    const m = scanWikiLinksInText('See [[page-name]] for more.');
    expect(m).toHaveLength(1);
    expect(m[0].target).toBe('page-name');
    expect(m[0].label).toBe('page-name');
    expect(m[0].index).toBe(4);
    expect(m[0].length).toBe('[[page-name]]'.length);
  });

  it('handles alias syntax', () => {
    const m = scanWikiLinksInText('See [[page|the name]] for more.');
    expect(m[0].target).toBe('page');
    expect(m[0].label).toBe('the name');
  });

  it('handles anchor syntax', () => {
    const m = scanWikiLinksInText('See [[page#section]] for more.');
    expect(m[0].target).toBe('page');
    expect(m[0].label).toBe('page');
  });

  it('handles alias + anchor combined', () => {
    const m = scanWikiLinksInText('See [[page#sec|the page]] for more.');
    expect(m[0].target).toBe('page');
    expect(m[0].label).toBe('the page');
  });

  it('finds multiple links in order', () => {
    const m = scanWikiLinksInText('[[a]] then [[b]] then [[c|d]]');
    expect(m.map((x) => x.target)).toEqual(['a', 'b', 'c']);
    expect(m.map((x) => x.label)).toEqual(['a', 'b', 'd']);
  });

  it('trims whitespace inside target/label', () => {
    const m = scanWikiLinksInText('[[  page  ]]');
    expect(m[0].target).toBe('page');
    expect(m[0].label).toBe('page');
  });

  it('skips malformed links', () => {
    // 单 [ 不是 wiki link
    expect(scanWikiLinksInText('[not a link]')).toEqual([]);
    // 空 target 不匹配
    expect(scanWikiLinksInText('[[]]')).toEqual([]);
    // 没有闭合
    expect(scanWikiLinksInText('[[unclosed')).toEqual([]);
  });

  it('preserves paths with slashes', () => {
    const m = scanWikiLinksInText('[[daily/2026-08-11]]');
    expect(m[0].target).toBe('daily/2026-08-11');
  });

  it('preserves Chinese characters in target', () => {
    const m = scanWikiLinksInText('[[汉语新解]]');
    expect(m[0].target).toBe('汉语新解');
  });

  it('handles image embeds (extra ! prefix is part of markdown, not included here)', () => {
    // Tiptap 渲染时 ![[image]] 是图片嵌入；但我们的纯文本扫描把它当作普通 wiki link。
    // 这是预期行为——上层（image extension）会用 ! 前缀单独处理。
    const m = scanWikiLinksInText('![[embedded-image]]');
    expect(m[0].target).toBe('embedded-image');
  });
});
