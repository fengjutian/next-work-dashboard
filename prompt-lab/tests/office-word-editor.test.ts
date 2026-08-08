import { describe, expect, it } from 'vitest';
import { parseCompactElements } from '../src/plugins/office-studio/OfficeWordEditor';

describe('Office Word compact element parsing', () => {
  it('parses paths, labels and text while ignoring totals', () => {
    expect(parseCompactElements('/body/p[1]\t[Heading 1]\t"Title"\n/body/p[2]\t[Normal]\t"Body"\ntotal: 2 of 2 elements')).toEqual([
      { path: '/body/p[1]', label: '[Heading 1]', text: 'Title' },
      { path: '/body/p[2]', label: '[Normal]', text: 'Body' },
    ]);
  });
});
