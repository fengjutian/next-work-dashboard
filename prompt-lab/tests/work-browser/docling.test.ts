import { describe, expect, it } from 'vitest';
import { normalizeDoclingResponse } from '@/main/work-browser/docling';

describe('Docling response normalization', () => {
  it('normalizes markdown and page OCR text', () => {
    const result = normalizeDoclingResponse({ document: { md_content: '# Title', pages: [{ page_no: 1, text: 'scanned text' }] } });
    expect(result.plainText).toBe('scanned text');
    expect(result.markdown).toBe('# Title');
    expect(result.pages[0].page).toBe(1);
  });
});
