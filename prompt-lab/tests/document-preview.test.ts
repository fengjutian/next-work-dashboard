import { describe, expect, it } from 'vitest';
import { previewParagraphs } from '../src/plugins/document-knowledge/preview';

describe('document text preview', () => {
  it('splits long restored PDF text into readable paragraphs', () => {
    const result = previewParagraphs(`first line\n${'word '.repeat(300)}`, 120);
    expect(result.length).toBeGreaterThan(2);
    expect(result.every((paragraph) => paragraph.length <= 121)).toBe(true);
    expect(result[0]).toBe('first line');
  });
});
