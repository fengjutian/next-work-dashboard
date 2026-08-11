import { describe, expect, it } from 'vitest';
import {
  allSettledWithConcurrency,
  describeLlmError,
  extractJson,
  isValidPerspectiveArray,
  isValidSynthesis,
  isTransientLlmError,
  parsePerspective,
  parseFastBatch,
  parseSynthesis,
} from '../src/plugins/zodiac-perspectives/zodiac-service';
import { ZODIAC_SIGNS } from '../src/plugins/zodiac-perspectives/zodiac-types';

describe('zodiac-service JSON parsing', () => {
  it('limits concurrent generation tasks and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 9 }, (_, index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    });
    const results = await allSettledWithConcurrency(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(results.map((result) => result.status === 'fulfilled' ? result.value : -1))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps rejected tasks without stopping the remaining queue', async () => {
    const results = await allSettledWithConcurrency([
      async () => 'first',
      async () => { throw new Error('broken'); },
      async () => 'third',
    ], 2);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('recognizes retryable provider errors without retrying ordinary validation errors', () => {
    expect(isTransientLlmError(new Error('LLM API error 429: busy'))).toBe(true);
    expect(isTransientLlmError(new Error('LLM API error 503: unavailable'))).toBe(true);
    expect(isTransientLlmError(new Error('缺少 interpretation 字段或为空'))).toBe(false);
  });

  it('turns provider failures into actionable user-facing errors', () => {
    expect(describeLlmError(new Error('LLM API error 401: invalid'))).toContain('API Key');
    expect(describeLlmError(new Error('LLM API error 429: busy'))).toContain('频繁');
    expect(describeLlmError(new Error('fetch failed'))).toContain('网络');
  });

  it('parses a complete fast-mode batch in zodiac order', () => {
    const raw = JSON.stringify({ perspectives: ZODIAC_SIGNS.map((sign) => ({
      sign, interpretation: `${sign} view`, focus: ['focus'], advice: ['act'],
    })) });
    expect(parseFastBatch(raw).map((item) => item.sign)).toEqual([...ZODIAC_SIGNS]);
  });

  it('keeps valid partial fast-mode results for targeted fallback', () => {
    const raw = JSON.stringify({ perspectives: [
      { sign: 'aries', interpretation: '先试一步', focus: ['行动'], advice: ['验证'] },
      { sign: 'taurus', interpretation: '', focus: ['成本'], advice: ['核算'] },
    ] });
    expect(parseFastBatch(raw).map((item) => item.sign)).toEqual(['aries']);
  });

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
      distinctiveViews: [{ sign: 'aquarius', difference: '质疑二选一前提' }],
    });
    const s = parseSynthesis(raw);
    expect(s.consensus).toHaveLength(3);
    expect(s.disagreements).toHaveLength(2);
    expect(s.blindSpots).toHaveLength(1);
    expect(s.nextSteps).toHaveLength(2);
    expect(s.distinctiveViews?.[0].sign).toBe('aquarius');
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
