import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/plugins/calcpath/curriculum';
import { calculateMastery, emptySkillState, evaluateAnswer, updateSkill } from '../src/plugins/calcpath/engine';

describe('CalcPath learning engine', () => {
  it('uses the documented five-dimension mastery weights', () => { const state = { ...emptySkillState('x'), concept: .9, calculation: .95, application: .7, transfer: .5, retention: .8 }; expect(calculateMastery(state)).toBeCloseTo(.7825); });
  it('normalizes equivalent authored answers', () => { expect(evaluateAnswer(PROBLEMS[2], ' 3x² ').correct).toBe(true); });
  it('detects a known chain-rule misconception', () => { const result = evaluateAnswer(PROBLEMS[3], '4x+2'); expect(result.correct).toBe(false); expect(result.misconception?.id).toBe('chain-rule.missing-inner-derivative'); });
  it('updates only the assessed dimension and schedules review', () => { const next = updateSkill(undefined, PROBLEMS[2], true, 0); expect(next.calculation).toBeGreaterThan(0); expect(next.concept).toBe(0); expect(next.nextReviewAt).toBeTruthy(); });
});
