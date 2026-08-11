/**
 * Document version / content hash
 */
import { describe, it, expect } from 'vitest';
import { computeContentHash, isContentChanged, newDocument, newDocumentVersion } from '@/core/work-browser/document/version';

describe('computeContentHash', () => {
  it('相同内容得出相同 hash', () => {
    expect(computeContentHash('hello world')).toBe(computeContentHash('hello world'));
  });

  it('空白归一化后再 hash', () => {
    expect(computeContentHash('hello  world\n\n')).toBe(computeContentHash('hello world'));
  });

  it('不同内容得出不同 hash', () => {
    expect(computeContentHash('hello')).not.toBe(computeContentHash('world'));
  });
});

describe('isContentChanged', () => {
  it('hash 一致则未变化', () => {
    const h = computeContentHash('abc');
    expect(isContentChanged(h, 'abc')).toBe(false);
  });

  it('hash 不一致则变化', () => {
    expect(isContentChanged('aabb', 'ccdd')).toBe(true);
  });
});

describe('newDocument', () => {
  it('构造时填充默认值', () => {
    const d = newDocument({
      workspaceId: 'ws1' as any,
      title: 'T',
      url: 'https://x.com',
      contentPath: '/p.md',
      rawPath: '/p.html',
      contentHash: 'h',
      wordCount: 10,
    });
    expect(d.sourceType).toBe('web');
    expect(d.capturedAt).toBeGreaterThan(0);
    expect(d.createdAt).toBe(d.updatedAt);
  });
});

describe('newDocumentVersion', () => {
  it('wordDelta 等于 word 差', () => {
    const v = newDocumentVersion({
      documentId: 'd1' as any,
      contentHash: 'h2',
      rawPath: '/r.html',
      prevWordCount: 100,
      wordCount: 130,
    });
    expect(v.wordDelta).toBe(30);
  });
});
