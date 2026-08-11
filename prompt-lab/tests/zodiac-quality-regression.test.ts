import { describe, expect, it } from 'vitest';
import { buildFastBatchUserPrompt, buildSingleSignUserPrompt } from '../src/plugins/zodiac-perspectives/zodiac-prompts';
import { ZODIAC_SIGNS } from '../src/plugins/zodiac-perspectives/zodiac-types';
import type { GenerationOptions } from '../src/plugins/zodiac-perspectives/zodiac-types';

const OPTIONS: GenerationOptions = {
  scene: 'decision', length: 'standard', tone: 'gentle', includeSynthesis: true, mode: 'standard', selectedSigns: [...ZODIAC_SIGNS],
};

describe('zodiac prompt quality regression', () => {
  it('gives every sign a distinct role seed for the same decision question', () => {
    const prompts = ZODIAC_SIGNS.map((sign) => buildSingleSignUserPrompt('我是否应该离开稳定但没有成长的工作？', OPTIONS, sign));
    expect(new Set(prompts).size).toBe(12);
    expect(prompts[0]).toContain('快速小步验证');
    expect(prompts[1]).toContain('成本');
    expect(prompts[9]).toContain('时间表');
    expect(prompts[10]).toContain('非传统');
  });

  it('requires fast mode to return all twelve ordered signs in one JSON object', () => {
    const prompt = buildFastBatchUserPrompt('测试问题', { ...OPTIONS, mode: 'fast' });
    for (const sign of ZODIAC_SIGNS) expect(prompt).toContain(sign);
    expect(prompt).toContain('一次性返回 12 个');
    expect(prompt).toContain('一次性返回');
  });
});
