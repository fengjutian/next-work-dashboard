/**
 * 十二星座视角插件 — 提示词模板
 *
 * 严格遵守需求 §8：
 *  - 把 12 星座视为虚构的思考原型，而非真实人格判断
 *  - 对同一事实保持一致，不为制造差异而编造背景
 *  - 差异必须体现在关注点、论证和行动建议，不能只替换形容词
 *  - 避免贬损、宿命论、恐吓和绝对化表达
 *  - 遇到信息不足时明确说明假设，并提出需要补充的问题
 *  - 对医疗、法律、财务、人身安全等高风险问题提供一般信息和求助建议，不以角色口吻给出确定性专业结论
 *  - 严格按约定 JSON Schema 输出
 */

import type {
  GenerationLength,
  GenerationOptions,
  GenerationScene,
  GenerationTone,
  ZodiacPerspective,
  ZodiacSign,
} from './zodiac-types';
import { getZodiacMeta } from './zodiac-data';

// ── 高风险问题识别（产品原则 §6） ──────────────────────────────

/** 高风险关键词白名单：医疗/法律/财务/自伤/暴力/紧急健康 */
const HIGH_RISK_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp; safeGuidance: string }> = [
  {
    category: '医疗',
    pattern: /(诊断|治疗|用药|剂量|病症|症状|医生|药物|手术|癌症|抑郁|焦虑|失眠|怀孕|胎儿)/i,
    safeGuidance: '医疗问题请以医生、药师或官方健康机构的专业意见为准，星座视角仅作为多角度启发，不能替代医学判断。',
  },
  {
    category: '法律',
    pattern: /(起诉|诉讼|仲裁|合同纠纷|违约|刑事责任|报警|律师|法律效力|公证)/i,
    safeGuidance: '法律问题请以执业律师或司法机构的意见为准，星座视角不能替代法律建议。',
  },
  {
    category: '财务',
    pattern: /(投资|股票|基金|加密货币|杠杆|配资|高回报|稳赚|无风险|月收益|年化.*?\d+%|借贷.*?利率)/i,
    safeGuidance: '财务决策请以持牌机构和专业顾问意见为准，星座视角不构成投资建议，亦不保证收益。',
  },
  {
    category: '人身安全',
    pattern: /(自残|自杀|自伤|不想活|结束生命|轻生|报复|伤害他人|暴力|恐吓)/i,
    safeGuidance: '如果你或身边的人正面临紧急危险，请立即联系当地紧急电话、心理援助热线或可信任的亲友。',
  },
];

export interface HighRiskMatch {
  category: string;
  guidance: string;
}

export function detectHighRisk(question: string): HighRiskMatch | null {
  for (const entry of HIGH_RISK_PATTERNS) {
    if (entry.pattern.test(question)) {
      return { category: entry.category, guidance: entry.safeGuidance };
    }
  }
  return null;
}

// ── 场景/篇幅/语气的用户侧描述 ────────────────────────────────

const SCENE_HINT: Record<GenerationScene, string> = {
  general:       '不限特定领域，请按问题自然展开。',
  work:          '聚焦职业、协作、绩效、成长与团队关系。',
  relationship:  '聚焦亲密关系、家庭、友情、社交边界。',
  decision:      '聚焦选择、权衡、利弊、时间表与可逆性。',
  creative:      '聚焦发散、灵感、表达风格、意象与故事性。',
  entertainment: '纯娱乐视角看待，不必严肃论证。',
};

const LENGTH_HINT: Record<GenerationLength, { perSign: string; charBudget: string }> = {
  short:    { perSign: '每个视角总长度 60～100 个汉字',  charBudget: '100' },
  standard: { perSign: '每个视角总长度 80～160 个汉字',  charBudget: '160' },
  detailed: { perSign: '每个视角总长度 160～260 个汉字', charBudget: '260' },
};

const TONE_HINT: Record<GenerationTone, string> = {
  rational:  '语气克制、客观、强调依据，避免情绪化修饰。',
  gentle:    '语气温和、包容、关注情绪，鼓励但不夸张。',
  sharp:     '语气直接、不绕弯，敢于点破盲点，但不要侮辱。',
  humorous:  '语气轻松、可调侃、可自嘲，避免说教。',
};

// ── 单星座输出 Schema（强约束） ──────────────────────────────────

const SINGLE_SIGN_JSON_SCHEMA_DESC = `
严格按以下 JSON Schema 输出，不要包含任何额外字段、不要 Markdown 围栏、不要解释文字：
{
  "interpretation": string,  // 50～${LENGTH_HINT.standard.charBudget} 字内，用自己的话陈述你对这个问题的理解
  "focus": string[],         // 2～5 条短句，描述你最关注什么
  "advice": string[],        // 2～5 条短句，给出可执行的建议
  "caution"?: string         // 可选，30 字内提醒一个潜在风险
}
`.trim();

// ── 汇总输出 Schema（强约束） ───────────────────────────────────

const SYNTHESIS_JSON_SCHEMA_DESC = `
严格按以下 JSON Schema 输出，不要包含额外字段、不要 Markdown 围栏、不要解释文字：
{
  "consensus": string[],            // 3～5 条，跨多视角的共识
  "disagreements": [                // 2～4 组
    { "topic": string, "positions": string[] }  // 每组 2～4 个不同立场
  ],
  "blindSpots": string[],           // 1～3 个容易忽略的盲点
  "nextSteps": string[]             // 1～5 条不依赖星座标签的综合行动建议
}
`.trim();

// ── 公共系统提示：所有调用都附加这一段 ──────────────────────────

export const COMMON_SYSTEM_PROMPT = `
你是 Next Work Dashboard 的「十二星座视角」AI 工具，负责用十二种虚构的星座思考原型理解用户问题并给出建议。

# 边界
1. 十二星座是启发式角色模型，不是人格判断或命运预测；不要把太阳星座描述为决定人格或行为的事实。
2. 对同一事实保持一致；不要为制造差异而编造用户没说过的事实。
3. 差异必须体现在关注点、论证和行动建议，不能只换形容词或星座名字。
4. 避免贬损、宿命论、恐吓和绝对化表达（例如不能说"某星座一定自私"）。
5. 用户问题涉及医疗、法律、财务、人身安全等高风险话题时：先给出一般信息和求助建议，不要以角色口吻给出确定性专业结论，并明确告知"星座视角不能替代专业意见"。
6. 用户问题信息不足时：明确写出你的假设，并提出需要补充的问题，不要硬答。
7. 保持娱乐化的语气和表达，不输出与问题无关的星座段子。

# 输出
1. 严格按约定的 JSON Schema 输出，键名拼写、类型、数组长度都必须满足要求。
2. 字符串内不要包含不可见控制字符；避免长 Markdown 表格或代码块。
3. 简体中文输出。
`.trim();

// ── 单星座用户消息构造 ─────────────────────────────────────────

export function buildSingleSignUserPrompt(
  question: string,
  options: GenerationOptions,
  sign: ZodiacSign,
): string {
  const meta = getZodiacMeta(sign);
  const length = LENGTH_HINT[options.length];
  return `
# 当前问题
${question.trim()}

# 场景
${SCENE_HINT[options.scene]}

# 篇幅
${length.perSign}。${options.length === 'short' ? '精炼直给' : options.length === 'detailed' ? '可展开论证与分步' : '简洁但有支撑'}。

# 语气
${TONE_HINT[options.tone]}

# 你的角色
${meta.seed}
视角关键词：${meta.keywords.join('、')}。
首要关注：${meta.focus}。

# 必须遵守
- 必须以中文回答，输出必须是合法 JSON。
${SINGLE_SIGN_JSON_SCHEMA_DESC.replace('${LENGTH_HINT.standard.charBudget}', length.charBudget)}
- 不要输出除了这个 JSON 之外的任何内容。
`.trim();
}

// ── 汇总用户消息构造 ─────────────────────────────────────────

export function buildSynthesisUserPrompt(
  question: string,
  options: GenerationOptions,
  perspectives: ZodiacPerspective[],
): string {
  const summary = perspectives
    .map((p) => {
      const meta = getZodiacMeta(p.sign);
      return `【${meta.name}】${p.interpretation} | 关注：${p.focus.join('、')} | 建议：${p.advice.join('、')}`;
    })
    .join('\n');
  return `
# 当前问题
${question.trim()}

# 场景 / 语气
场景：${SCENE_HINT[options.scene]}
语气：${TONE_HINT[options.tone]}

# 已收集到的 12 个视角摘要
${summary}

# 你的任务
基于以上 12 份视角，写一份综合性的"圆桌纪要"：
1. 提炼 3～5 条跨视角共识；
2. 找出 2～4 组有代表性的分歧，说明每个分歧的核心张力；
3. 指出 1～3 个原问题可能忽略的盲点；
4. 给出 1～5 条不依赖任何星座标签的综合行动建议，每条都说明"为什么这条管用"。

# 约束
- 不要简单复述上面 12 份视角；要有归纳、对比、批判。
- 不要用投票数量宣称某个答案"客观正确"。
${SYNTHESIS_JSON_SCHEMA_DESC}
- 严格 JSON，不要 Markdown 围栏或额外文字。
`.trim();
}

// ── 追问用：把单星座的历史回答当作 system + 新的问题当作 user ──

export function buildFollowupSystemPrompt(
  sign: ZodiacSign,
  originalQuestion: string,
  originalAnswer: ZodiacPerspective,
): string {
  const meta = getZodiacMeta(sign);
  return `
${COMMON_SYSTEM_PROMPT}

# 当前模式：单星座追问
你正在以「${meta.name}」的视角与用户继续对话。
视角关键词：${meta.keywords.join('、')}。
首要关注：${meta.focus}。
${meta.seed}

# 历史轮次
原始问题：${originalQuestion.trim()}
历史回答：${originalAnswer.interpretation}
建议：${originalAnswer.advice.join('、')}

# 规则
1. 始终保持「${meta.name}」视角的关切与表达方式。
2. 不要复述历史回答；直接回应用户的追问。
3. 高风险话题依然要给出一般信息和求助建议，不给确定性专业结论。
4. 输出必须是面向用户的纯文本（不要 JSON），简洁、有立场、可执行。
`.trim();
}
