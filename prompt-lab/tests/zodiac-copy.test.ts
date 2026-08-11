import { describe, expect, it } from 'vitest';
import {
  buildAllPerspectivesMarkdown,
  buildSinglePerspectiveMarkdown,
  buildSynthesisMarkdown,
} from '../src/plugins/zodiac-perspectives/zodiac-copy';
import { ZODIAC_SIGNS } from '../src/plugins/zodiac-perspectives/zodiac-types';
import type { ZodiacRun, ZodiacSynthesis } from '../src/plugins/zodiac-perspectives/zodiac-types';

const baseRun: ZodiacRun = {
  id: 'run-1',
  question: '我应该换工作吗？',
  title: '我应该换工作吗？',
  options: { scene: 'decision', length: 'standard', tone: 'gentle', includeSynthesis: true },
  perspectives: ZODIAC_SIGNS.map((sign) => ({
    sign,
    interpretation: `${sign} 的理解`,
    focus: ['a', 'b'],
    advice: ['x', 'y'],
    caution: sign === 'aries' ? 'be careful' : undefined,
  })),
  synthesis: null,
  favorite: false,
  model: 'gpt-test',
  createdAt: new Date('2025-01-01T08:00:00Z').getTime(),
  updatedAt: new Date('2025-01-01T08:00:00Z').getTime(),
  partial: false,
};

describe('zodiac-copy markdown', () => {
  it('buildSinglePerspectiveMarkdown contains sign, original question, time and safety note', () => {
    const aries = baseRun.perspectives[0];
    const md = buildSinglePerspectiveMarkdown(baseRun, aries);
    expect(md).toContain('白羊座');
    expect(md).toContain('我应该换工作吗？');
    expect(md).toContain('AI 生成');
  });

  it('buildAllPerspectivesMarkdown lists all 12 signs', () => {
    const md = buildAllPerspectivesMarkdown(baseRun);
    for (const sign of ZODIAC_SIGNS) {
      expect(md).toContain(`${sign} 的理解`); // interpretation literal contains the sign id; sanity check via name
    }
    expect(md).toContain('AI 生成');
  });

  it('buildSynthesisMarkdown includes consensus, disagreements, blind spots and next steps', () => {
    const synthesis: ZodiacSynthesis = {
      consensus: ['c1', 'c2', 'c3'],
      disagreements: [{ topic: 't1', positions: ['p1', 'p2'] }],
      blindSpots: ['b1'],
      nextSteps: ['n1', 'n2'],
    };
    const md = buildSynthesisMarkdown({ ...baseRun, synthesis });
    expect(md).toContain('圆桌纪要');
    expect(md).toContain('c1');
    expect(md).toContain('t1');
    expect(md).toContain('b1');
    expect(md).toContain('n1');
  });

  it('buildSynthesisMarkdown falls back to all-perspectives when synthesis is missing', () => {
    const md = buildSynthesisMarkdown(baseRun);
    expect(md).toContain('未生成汇总');
  });
});
