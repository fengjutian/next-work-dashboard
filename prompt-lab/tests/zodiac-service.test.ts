import { describe, expect, it } from 'vitest';
import {
  extractJson,
  isValidPerspectiveArray,
  isValidSynthesis,
  parsePerspective,
  parseSynthesis,
} from '../src/plugins/zodiac-perspectives/zodiac-service';
import { ZODIAC_SIGNS } from '../src/plugins/zodiac-perspectives/zodiac-types';

describe('zodiac-service JSON parsing', () => {
  it('extractJson unwraps fenced ```json``` blocks', () => {
    const raw = '噪音```json\n{"interpretation":"X","focus":["a"],"advice":["b"]}\n```尾部';
    const parsed = extractJson(raw) as Record<string, unknown>;
    expect(parsed.interpretation).toBe('X');
  });

  it('extractJson unwraps plain JSON with surrounding noise', () => {
    const raw = '前缀废话 {"interpretation":"X","focus":["a"],"advice":["b"]} 后缀';
    const parsed = extractJson(raw) as Record<string, unknown>;
    expect(parsed.interpretation).toBe('X');
  });

  it('extractJson throws when no JSON object is present', () => {
    expect(() => extractJson('没有 json 的纯文本')).toThrow();
  });

  it('parsePerspective trims control characters and clips strings', () => {
    const raw = JSON.stringify({
      interpretation: 'A'.repeat(1200) + '',
      focus: ['f1', 'f2', '', null, 5],
      advice: ['a1', 'a2'],
      caution: 'A'.repeat(500),
    });
    const p = parsePerspective(raw, 'aries');
    expect(p.sign).toBe('aries');
    expect(p.interpretation.length).toBeLessThanOrEqual(600);
    expect(p.focus).toEqual(['f1', 'f2']);
    expect(p.advice).toEqual(['a1', 'a2']);
    expect(p.caution?.length).toBeLessThanOrEqual(100);
  });

  it('parsePerspective throws when interpretation is empty', () => {
    const raw = JSON.stringify({ interpretation: '', focus: ['x'], advice: ['y'] });
    expect(() => parsePerspective(raw, 'taurus')).toThrow();
  });

  it('parseSynthesis enforces minimum consensus and disagreements', () => {
    const raw = JSON.stringify({
      consensus: ['c1', 'c2', 'c3'],
      disagreements: [
        { topic: 't1', positions: ['p1', 'p2'] },
        { topic: 't2', positions: ['q1', 'q2', 'q3'] },
      ],
      blindSpots: ['b1'],
      nextSteps: ['n1', 'n2'],
    });
    const s = parseSynthesis(raw);
    expect(s.consensus).toHaveLength(3);
    expect(s.disagreements).toHaveLength(2);
    expect(s.blindSpots).toHaveLength(1);
    expect(s.nextSteps).toHaveLength(2);
  });

  it('parseSynthesis rejects too few consensus items', () => {
    const raw = JSON.stringify({
      consensus: ['only-one'],
      disagreements: [{ topic: 't', positions: ['p1', 'p2'] }],
      blindSpots: ['b1'],
      nextSteps: ['n1'],
    });
    expect(() => parseSynthesis(raw)).toThrow();
  });

  it('isValidPerspectiveArray requires 12 unique signs', () => {
    const valid = ZODIAC_SIGNS.map((sign) => ({
      sign,
      interpretation: 'x',
      focus: ['a'],
      advice: ['b'],
    }));
    expect(isValidPerspectiveArray(valid)).toBe(true);

    const missingOne = valid.slice(0, 11);
    expect(isValidPerspectiveArray(missingOne)).toBe(false);

    const duplicate = [...valid];
    duplicate[0] = { ...duplicate[0], sign: 'aries' };
    duplicate[1] = { ...duplicate[1], sign: 'aries' };
    expect(isValidPerspectiveArray(duplicate)).toBe(false);
  });

  it('isValidSynthesis accepts a complete object', () => {
    expect(isValidSynthesis({
      consensus: ['a'],
      disagreements: [{ topic: 't', positions: ['p', 'q'] }],
      blindSpots: ['b'],
      nextSteps: ['n'],
    })).toBe(true);
    expect(isValidSynthesis(null)).toBe(false);
    expect(isValidSynthesis({ consensus: [] })).toBe(false);
  });
});
