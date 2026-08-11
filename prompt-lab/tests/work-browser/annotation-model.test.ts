/**
 * annotation/model
 */
import { describe, it, expect } from 'vitest';
import { createAnnotation, normalizeSelector } from '@/core/work-browser/annotation/model';

describe('createAnnotation', () => {
  it('创建带默认 color 和 note', () => {
    const a = createAnnotation({
      documentId: 'd1' as any,
      rangeText: 'foo bar',
      selector: '.content > p',
    });
    expect(a.id).toBeTruthy();
    expect(a.color).toBe('yellow');
    expect(a.note).toBe('');
    expect(a.rangeText).toBe('foo bar');
    expect(a.selector).toBe('.content > p');
    expect(a.createdAt).toBe(a.updatedAt);
  });

  it('支持自定义 color 和 note', () => {
    const a = createAnnotation({
      documentId: 'd1' as any,
      rangeText: 'bar',
      selector: '.x',
      color: 'green',
      note: 'important',
    });
    expect(a.color).toBe('green');
    expect(a.note).toBe('important');
  });
});

describe('normalizeSelector', () => {
  it('保持原样', () => {
    expect(normalizeSelector('article > p:nth-child(2)')).toBe('article > p:nth-child(2)');
  });

  it('截断超长选择器', () => {
    const long = 'a'.repeat(5000);
    const out = normalizeSelector(long, 100);
    expect(out.length).toBe(100);
  });
});
