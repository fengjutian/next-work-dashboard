import { describe, expect, it } from 'vitest';
import { columnLabel, excelCellAddress } from '../src/plugins/office-studio/OfficeExcelGrid';

describe('Office Studio Excel addressing', () => {
  it('converts zero-based columns to Excel labels', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLabel)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('creates an OfficeCLI cell address', () => {
    expect(excelCellAddress('Sales 2026', 4, 27)).toBe('Sales 2026!AB5');
  });
});
