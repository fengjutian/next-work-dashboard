import { describe, expect, it } from 'vitest';
import {
  evaluatePerspectiveQuality,
  hasValidDistinctiveViews,
  maxPairSimilarity,
  passesHighRiskGate,
} from '../src/plugins/zodiac-perspectives/zodiac-quality';
import type { ZodiacPerspective, ZodiacSynthesis } from '../src/plugins/zodiac-perspectives/zodiac-types';

const perspective = (sign: ZodiacPerspective['sign'], interpretation: string, advice: string[]): ZodiacPerspective => ({
  sign, interpretation, focus: ['核心关注'], advice,
});

describe('zodiac automatic quality gate', () => {
  it('enforces pairwise similarity ceiling', () => {
    const distinct = [perspective('aries', '先小步尝试获取反馈', ['制定三天验证计划']), perspective('taurus', '评估长期成本与现金储备', ['核算六个月预算'])];
    expect(maxPairSimilarity(distinct)).toBeLessThan(0.65);
    const duplicate = [perspective('aries', '先检查风险再行动', ['列出风险']), perspective('taurus', '先检查风险再行动', ['列出风险'])];
    expect(maxPairSimilarity(duplicate)).toBe(1);
  });

  it('requires actionable advice and rejects fatalistic claims', () => {
    expect(evaluatePerspectiveQuality(perspective('virgo', '把问题拆细', ['列出三个步骤'])).hasActionVerb).toBe(true);
    expect(evaluatePerspectiveQuality(perspective('leo', '某星座一定会成功', ['等待结果'])).hasFatalism).toBe(true);
    expect(evaluatePerspectiveQuality(perspective('pisces', '这是命中注定', ['尝试沟通'])).hasFatalism).toBe(true);
  });

  it('requires professional guidance for high-risk questions', () => {
    expect(passesHighRiskGate('失眠严重应该吃什么药？', '建议放松心情')).toBe(false);
    expect(passesHighRiskGate('失眠严重应该吃什么药？', '请咨询医生或药师，本回答不能替代专业意见。')).toBe(true);
  });

  it('only allows distinctive views that exist in generated signs', () => {
    const synthesis: ZodiacSynthesis = { consensus: ['a'], disagreements: [{ topic: 't', positions: ['a', 'b'] }], blindSpots: ['b'], nextSteps: ['c'], distinctiveViews: [{ sign: 'aquarius', difference: '创新' }] };
    expect(hasValidDistinctiveViews(synthesis, ['aries', 'aquarius'])).toBe(true);
    expect(hasValidDistinctiveViews(synthesis, ['aries'])).toBe(false);
  });
});
