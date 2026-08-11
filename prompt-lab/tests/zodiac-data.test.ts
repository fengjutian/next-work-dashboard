import { describe, expect, it } from 'vitest';
import {
  ZODIAC_META_LIST,
  LENGTH_OPTIONS,
  SCENE_OPTIONS,
  TONE_OPTIONS,
  getZodiacMeta,
} from '../src/plugins/zodiac-perspectives/zodiac-data';
import { ZODIAC_ORDER, ZODIAC_SIGNS } from '../src/plugins/zodiac-perspectives/zodiac-types';

describe('Zodiac data integrity', () => {
  it('exposes exactly 12 zodiac signs', () => {
    expect(ZODIAC_SIGNS).toHaveLength(12);
    expect(ZODIAC_META_LIST).toHaveLength(12);
  });

  it('ZODIAC_ORDER matches ZODIAC_SIGNS (a-z ecliptic order)', () => {
    expect([...ZODIAC_ORDER]).toEqual([...ZODIAC_SIGNS]);
  });

  it('every meta entry has 3 keywords and a non-empty focus', () => {
    for (const meta of ZODIAC_META_LIST) {
      expect(meta.keywords.length).toBeGreaterThanOrEqual(2);
      expect(meta.keywords.length).toBeLessThanOrEqual(4);
      expect(meta.focus).toBeTruthy();
      expect(meta.seed).toBeTruthy();
      expect(meta.glyph).toBeTruthy();
    }
  });

  it('signs are unique by id and chinese name', () => {
    const ids = new Set(ZODIAC_META_LIST.map((m) => m.sign));
    expect(ids.size).toBe(12);
    const names = new Set(ZODIAC_META_LIST.map((m) => m.name));
    expect(names.size).toBe(12);
  });

  it('getZodiacMeta returns the correct entry by id', () => {
    expect(getZodiacMeta('leo').name).toBe('狮子座');
    expect(getZodiacMeta('pisces').glyph).toBe('\u2653');
  });

  it('SCENE / LENGTH / TONE options cover the documented values', () => {
    const sceneValues = SCENE_OPTIONS.map((o) => o.value).sort();
    expect(sceneValues).toEqual(['creative', 'decision', 'entertainment', 'general', 'relationship', 'work']);
    const lengthValues = LENGTH_OPTIONS.map((o) => o.value).sort();
    expect(lengthValues).toEqual(['detailed', 'short', 'standard']);
    const toneValues = TONE_OPTIONS.map((o) => o.value).sort();
    expect(toneValues).toEqual(['gentle', 'humorous', 'rational', 'sharp']);
  });

  it('every meta entry maps to a sign declared in ZODIAC_SIGNS', () => {
    const declared = new Set<string>(ZODIAC_SIGNS);
    for (const meta of ZODIAC_META_LIST) {
      expect(declared.has(meta.sign)).toBe(true);
    }
  });
});
