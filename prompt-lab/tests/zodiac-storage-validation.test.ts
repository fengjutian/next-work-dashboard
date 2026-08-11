import { describe, expect, it } from 'vitest';
import { normalizePerspectives, normalizeSynthesis } from '../src/plugins/zodiac-perspectives/zodiac-storage';

describe('zodiac storage validation', () => {
  it('drops malformed and duplicate perspectives while preserving valid partial data', () => {
    const result = normalizePerspectives([
      { sign: 'taurus', interpretation: '稳健', focus: ['成本'], advice: ['核算'] },
      { sign: 'taurus', interpretation: '重复', focus: ['x'], advice: ['y'] },
      { sign: 'unknown', interpretation: '非法', focus: ['x'], advice: ['y'] },
      { sign: 'aries', interpretation: '', focus: ['行动'], advice: ['试试'] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sign).toBe('taurus');
  });

  it('rejects incomplete synthesis records', () => {
    expect(normalizeSynthesis({ consensus: ['a'] })).toBeNull();
    expect(normalizeSynthesis({
      consensus: ['a'],
      disagreements: [{ topic: '速度', positions: ['快', '慢'] }],
      blindSpots: ['b'],
      nextSteps: ['c'],
    })).not.toBeNull();
  });
});
