/**
 * 十二星座元数据 — 视角关键词、首要关注、视角种子
 *
 * 严格按需求 §6.3 内容基线；不是对现实个体的断言。
 * 修改顺序请保持 ZODIAC_ORDER（黄道顺序）。
 */

import type {
  GenerationLength,
  GenerationMode,
  GenerationScene,
  GenerationTone,
  ZodiacMeta,
  ZodiacSign,
} from './zodiac-types';
import { ZODIAC_ORDER } from './zodiac-types';

export const ZODIAC_META: Readonly<Record<ZodiacSign, ZodiacMeta>> = {
  aries: {
    sign: 'aries',
    name: '白羊座',
    englishName: 'Aries',
    glyph: '\u2648',
    keywords: ['直接', '行动', '突破'],
    focus: '现在能做什么，怎样快速验证',
    seed: '你像白羊座一样思考：把问题拆成"立刻可执行的一步"，关注能否快速小步验证，倾向先做再调整。',
  },
  taurus: {
    sign: 'taurus',
    name: '金牛座',
    englishName: 'Taurus',
    glyph: '\u2649',
    keywords: ['稳定', '价值', '耐久'],
    focus: '成本收益、资源和长期可靠性',
    seed: '你像金牛座一样思考：把问题放到 6～12 个月尺度上衡量成本、资源、稳定性与可累积价值，关注是否扎实可靠。',
  },
  gemini: {
    sign: 'gemini',
    name: '双子座',
    englishName: 'Gemini',
    glyph: '\u264A',
    keywords: ['信息', '变化', '连接'],
    focus: '是否存在其他解释和沟通路径',
    seed: '你像双子座一样思考：寻找其他可能的解释、更顺畅的沟通路径、对立面观点，避免单一视角过早下结论。',
  },
  cancer: {
    sign: 'cancer',
    name: '巨蟹座',
    englishName: 'Cancer',
    glyph: '\u264B',
    keywords: ['感受', '安全', '照顾'],
    focus: '对关系、归属感和情绪的影响',
    seed: '你像巨蟹座一样思考：评估这件事对关系、归属感、家人和自己情绪安全的影响，关注有没有被忽略的情感成本。',
  },
  leo: {
    sign: 'leo',
    name: '狮子座',
    englishName: 'Leo',
    glyph: '\u264C',
    keywords: ['自信', '创造', '影响'],
    focus: '主导权、表达效果和个人价值',
    seed: '你像狮子座一样思考：这件事让我能发挥什么价值？我能否主导叙事？表达方式本身够不够有感染力？',
  },
  virgo: {
    sign: 'virgo',
    name: '处女座',
    englishName: 'Virgo',
    glyph: '\u264D',
    keywords: ['细节', '秩序', '改进'],
    focus: '漏洞、步骤、标准和可优化处',
    seed: '你像处女座一样思考：拆解执行步骤、列出潜在漏洞、给出可复用的清单，把模糊的判断变成可验证的细节。',
  },
  libra: {
    sign: 'libra',
    name: '天秤座',
    englishName: 'Libra',
    glyph: '\u264E',
    keywords: ['平衡', '公平', '协商'],
    focus: '各方立场、关系成本和折中方案',
    seed: '你像天秤座一样思考：列出各方的核心利益与关系成本，比较不同折中方案，给出"对各方最不坏"的协调路径。',
  },
  scorpio: {
    sign: 'scorpio',
    name: '天蝎座',
    englishName: 'Scorpio',
    glyph: '\u264F',
    keywords: ['深度', '动机', '边界'],
    focus: '隐藏动机、信任、风险和底线',
    seed: '你像天蝎座一样思考：剥开表面看真实动机，识别信任与风险信号，划出哪些是绝对不能碰的底线。',
  },
  sagittarius: {
    sign: 'sagittarius',
    name: '射手座',
    englishName: 'Sagittarius',
    glyph: '\u2650',
    keywords: ['可能', '成长', '远方'],
    focus: '长期意义、自由度和新机会',
    seed: '你像射手座一样思考：把问题放到长期意义下评估，关注它能否带来成长、视野、自由度或新机会。',
  },
  capricorn: {
    sign: 'capricorn',
    name: '摩羯座',
    englishName: 'Capricorn',
    glyph: '\u2651',
    keywords: ['目标', '责任', '执行'],
    focus: '现实约束、计划、责任和结果',
    seed: '你像摩羯座一样思考：把问题落到可量化目标、时间表、责任人和现实约束上，关注结果而非意愿。',
  },
  aquarius: {
    sign: 'aquarius',
    name: '水瓶座',
    englishName: 'Aquarius',
    glyph: '\u2652',
    keywords: ['独立', '系统', '创新'],
    focus: '规则是否合理及非传统解法',
    seed: '你像水瓶座一样思考：质疑默认规则是否合理，寻找非传统、结构性、创新性解法，看能否把约束变成杠杆。',
  },
  pisces: {
    sign: 'pisces',
    name: '双鱼座',
    englishName: 'Pisces',
    glyph: '\u2653',
    keywords: ['共情', '想象', '融合'],
    focus: '未表达的感受、愿景和温柔解法',
    seed: '你像双鱼座一样思考：捕捉问题中未说出口的感受，尝试以温柔、想象力和人本视角给出解法，避免冷硬对抗。',
  },
};

export const ZODIAC_META_LIST: readonly ZodiacMeta[] = ZODIAC_ORDER.map(
  (sign) => ZODIAC_META[sign],
);

/** 给定 id 返回元数据，理论上 id 一定在白名单中，缺失时返回白羊（防御性兜底） */
export function getZodiacMeta(sign: ZodiacSign): ZodiacMeta {
  return ZODIAC_META[sign] ?? ZODIAC_META.aries;
}

// ── 生成选项的展示文本 ─────────────────────────────────────────

export const SCENE_OPTIONS: ReadonlyArray<{ value: GenerationScene; label: string; hint: string }> = [
  { value: 'general',       label: '通用',   hint: '不限领域，按问题自然展开' },
  { value: 'work',          label: '工作',   hint: '聚焦职业、协作与成长' },
  { value: 'relationship',  label: '关系',   hint: '聚焦亲密、家人、社交' },
  { value: 'decision',      label: '决策',   hint: '聚焦选择、权衡与风险' },
  { value: 'creative',      label: '创意',   hint: '聚焦发散、灵感与表达' },
  { value: 'entertainment', label: '娱乐',   hint: '纯娱乐视角轻松看待' },
];

export const LENGTH_OPTIONS: ReadonlyArray<{ value: GenerationLength; label: string; hint: string }> = [
  { value: 'short',    label: '简短', hint: '每个视角 60～100 字' },
  { value: 'standard', label: '标准', hint: '每个视角 80～160 字（推荐）' },
  { value: 'detailed', label: '深入', hint: '每个视角 160～260 字' },
];

export const TONE_OPTIONS: ReadonlyArray<{ value: GenerationTone; label: string; hint: string }> = [
  { value: 'rational',  label: '理性', hint: '克制、客观、强调依据' },
  { value: 'gentle',    label: '温和', hint: '包容、鼓励、关注情绪' },
  { value: 'sharp',     label: '犀利', hint: '直接、不绕弯、敢于点破' },
  { value: 'humorous',  label: '幽默', hint: '轻松、调侃、避免说教' },
];

export const MODE_OPTIONS: ReadonlyArray<{ value: GenerationMode; label: string; hint: string }> = [
  { value: 'fast', label: '快速', hint: '1 次请求，短回答，不生成总结' },
  { value: 'standard', label: '标准', hint: '12 个独立视角，可生成总结' },
  { value: 'deep', label: '深度', hint: '深入回答并生成圆桌总结' },
];
