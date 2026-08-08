import { describe, expect, it } from 'vitest';
import { parseNameStatus, parsePorcelain } from '../scripts/knowledge-cli';

describe('knowledge CLI git change parsing', () => {
  it('parses commit range changes including both sides of renames', () => {
    expect(parseNameStatus('M\0src/main.ts\0R100\0src/old.ts\0src/new.ts\0')).toEqual([
      { status: 'M', path: 'src/main.ts' },
      { status: 'R100', path: 'src/old.ts' },
      { status: 'R100', path: 'src/new.ts' },
    ]);
  });

  it('parses working tree porcelain including rename records', () => {
    expect(parsePorcelain(' M src/main.ts\0R  src/new.ts\0src/old.ts\0')).toEqual([
      { status: ' M', path: 'src/main.ts' },
      { status: 'R ', path: 'src/new.ts' },
      { status: 'R ', path: 'src/old.ts' },
    ]);
  });
});
