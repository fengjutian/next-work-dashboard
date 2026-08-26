import { describe, expect, it } from 'vitest';
import { makeWereadMarkdown, safeWereadFilename, wereadBookFingerprint, type WereadExportBook } from '../src/core/export';

function book(): WereadExportBook {
  return {
    bookId: 'book-1', title: '测试/书名', author: '作者',
    highlights: [{ bookmarkId: 'h1', markText: '值得记住的内容', createTime: 1_748_563_200, deepLink: 'weread://valid-from-api', chapter: { title: '第一章' } }],
    reviews: [{ review: { reviewId: 'r1', abstract: '原文', content: '我的想法', createTime: 1_748_563_200 } }],
  };
}

describe('WeRead Markdown export', () => {
  it('exports stable metadata, note anchors, dates and API deep links', () => {
    const markdown = makeWereadMarkdown([book()]);
    expect(markdown).toContain('book_id: "book-1"');
    expect(markdown).toContain('<a id="weread-h1"></a>');
    expect(markdown).toContain('创建日期：2025-05-30');
    expect(markdown).toContain('[打开微信读书](weread://valid-from-api)');
  });

  it('changes fingerprints only when note content changes', () => {
    const original = book(); const renamed = { ...original, title: '新标题' };
    expect(wereadBookFingerprint(renamed)).toBe(wereadBookFingerprint(original));
    expect(wereadBookFingerprint({ ...original, highlights: [{ ...original.highlights[0], markText: '变化' }] })).not.toBe(wereadBookFingerprint(original));
  });

  it('creates a Windows-safe filename', () => expect(safeWereadFilename('测试/书名:*?')).toBe('测试_书名___'));
});
