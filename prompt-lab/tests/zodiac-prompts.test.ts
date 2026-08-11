import { describe, expect, it } from 'vitest';
import {
  COMMON_SYSTEM_PROMPT,
  buildFollowupSystemPrompt,
  buildQuestionContextPrompt,
  buildSingleSignUserPrompt,
  buildSynthesisUserPrompt,
  detectHighRisk,
} from '../src/plugins/zodiac-perspectives/zodiac-prompts';
import { ZODIAC_META } from '../src/plugins/zodiac-perspectives/zodiac-data';
import {
  ZODIAC_SIGNS,
  type GenerationOptions,
  type ZodiacPerspective,
} from '../src/plugins/zodiac-perspectives/zodiac-types';

const BASE_OPTIONS: GenerationOptions = {
  scene: 'decision',
  length: 'standard',
  tone: 'gentle',
  includeSynthesis: true,
  mode: 'standard',
  selectedSigns: [...ZODIAC_SIGNS],
};

describe('Zodiac prompts', () => {
  it('COMMON_SYSTEM_PROMPT forbids personality / fate claims and demands strict JSON', () => {
    expect(COMMON_SYSTEM_PROMPT).toContain('十二星座');
    expect(COMMON_SYSTEM_PROMPT).toContain('JSON');
  });

  it('detectHighRisk flags medical / legal / financial / self-harm', () => {
    expect(detectHighRisk('我最近失眠很严重，要不要吃药？')?.category).toBe('医疗');
    expect(detectHighRisk('这份合同违约了我可以起诉吗？')?.category).toBe('法律');
    expect(detectHighRisk('这个币年化 200% 能投吗？')?.category).toBe('财务');
    expect(detectHighRisk('我真的不想活了')?.category).toBe('人身安全');
  });

  it('detectHighRisk returns null for ordinary questions', () => {
    expect(detectHighRisk('我应该换工作吗？')).toBeNull();
    expect(detectHighRisk('朋友很久不回复我消息')).toBeNull();
  });

  it('buildSingleSignUserPrompt injects the sign seed and forbids Markdown', () => {
    const prompt = buildSingleSignUserPrompt('我该换工作吗', BASE_OPTIONS, 'aries');
    expect(prompt).toContain('白羊座一样思考');
    expect(prompt).toContain('白羊座');
    expect(prompt).toContain('我该换工作吗');
    expect(prompt).toContain('权衡'); // 场景 decision 的中文描述：聚焦选择、权衡与风险
    expect(prompt).toContain('JSON');
  });

  it('buildSingleSignUserPrompt includes focus keywords for the selected sign', () => {
    const prompt = buildSingleSignUserPrompt('换不换', BASE_OPTIONS, 'scorpio');
    expect(prompt).toContain('隐藏动机');
    expect(prompt).toContain('底线');
  });

  it('buildSynthesisUserPrompt summarizes all 12 perspectives and forbids voting', () => {
    const perspectives: ZodiacPerspective[] = ZODIAC_SIGNS.map((sign) => {
      const meta = ZODIAC_META[sign];
      return {
        sign,
        interpretation: `${meta.name} 视角的回答。`,
        focus: [`${meta.name} 关注 X`, `${meta.name} 关注 Y`],
        advice: [`${meta.name} 建议 1`, `${meta.name} 建议 2`],
      } satisfies ZodiacPerspective;
    });
    const prompt = buildSynthesisUserPrompt('原问题', BASE_OPTIONS, perspectives);
    expect(prompt).toContain('白羊座');
    expect(prompt).toContain('双鱼座');
    expect(prompt).toContain('投票数量');
  });

  it('buildFollowupSystemPrompt preserves original question and sign identity', () => {
    const original: ZodiacPerspective = {
      sign: 'virgo',
      interpretation: '原视角回答',
      focus: ['细节', '清单'],
      advice: ['列步骤', '找漏洞'],
    };
    const prompt = buildFollowupSystemPrompt('virgo', '原问题', original);
    expect(prompt).toContain('处女座');
    expect(prompt).toContain('原问题');
    expect(prompt).toContain('原视角回答');
    expect(prompt).toContain('追问');
  });

  it('buildQuestionContextPrompt separates facts, assumptions and missing information', () => {
    const prompt = buildQuestionContextPrompt('我该辞职吗？');
    expect(prompt).toContain('knownFacts');
    expect(prompt).toContain('assumptions');
    expect(prompt).toContain('missingInformation');
    expect(prompt).toContain('不得补造');
  });
});
