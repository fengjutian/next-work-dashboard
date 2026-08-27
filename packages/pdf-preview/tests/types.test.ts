import { describe, expect, it } from 'vitest';
import { INITIAL_PDF_STATE } from '../src/core/types';

describe('PdfPreview types', () => {
  it('exposes a sane initial state', () => {
    expect(INITIAL_PDF_STATE).toEqual({
      status: 'idle',
      fileName: null,
      pageCount: 0,
      currentPage: 1,
      pageImageUrl: null,
      scale: 1,
      error: null,
    });
  });

  it('status enum has the expected four values', () => {
    const expected = ['idle', 'loading', 'loaded', 'error'] as const;
    type Status = (typeof INITIAL_PDF_STATE)['status'];
    const _check: Status[] = [...expected];
    expect(_check).toHaveLength(4);
  });
});
