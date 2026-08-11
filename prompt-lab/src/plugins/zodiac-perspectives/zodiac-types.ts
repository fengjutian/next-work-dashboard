/**
 * 十二星座视角插件 — 类型与数据契约
 *
 * 设计原则：
 * - 服务端输出与 UI 展示共用同一份类型，避免双向漂移
 * - 所有面向用户的字符串都视为不可信：写入前 sanitize，渲染前 escape
 * - DB 行的形状独立于领域类型，在 zodiac-storage 适配
 */

// ── 星座标识与元数据 ─────────────────────────────────────────────

export const ZODIAC_SIGNS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
] as const;

export type ZodiacSign = typeof ZODIAC_SIGNS[number];

export interface ZodiacMeta {
  sign: ZodiacSign;
  name: string;          // 中文名
  englishName: string;   // 英文名
  glyph: string;         // 星座符号 ♈♉♊…
  keywords: readonly string[];
  focus: string;         // 首要关注
  /** 视角种子：进入系统 prompt 的描述锚点 */
  seed: string;
}

/** 黄道十二宫顺序 */
export const ZODIAC_ORDER: readonly ZodiacSign[] = ZODIAC_SIGNS;

// ── 生成选项 ─────────────────────────────────────────────────────

export type GenerationScene = 'general' | 'work' | 'relationship' | 'decision' | 'creative' | 'entertainment';
export type GenerationLength = 'short' | 'standard' | 'detailed';
export type GenerationTone = 'rational' | 'gentle' | 'sharp' | 'humorous';

export interface GenerationOptions {
  scene: GenerationScene;
  length: GenerationLength;
  tone: GenerationTone;
  includeSynthesis: boolean;
}

// ── 服务端输出契约（§7） ──────────────────────────────────────────

export interface ZodiacPerspective {
  sign: ZodiacSign;
  interpretation: string;
  focus: string[];
  advice: string[];
  caution?: string;
}

export interface ZodiacSynthesis {
  consensus: string[];
  disagreements: Array<{ topic: string; positions: string[] }>;
  blindSpots: string[];
  nextSteps: string[];
  /** 汇总模型识别出的独特视角，供“只看差异”使用。 */
  distinctiveViews?: Array<{ sign: ZodiacSign; difference: string }>;
}

export interface ZodiacPerspectiveResult {
  question: string;
  perspectives: ZodiacPerspective[];
  synthesis?: ZodiacSynthesis;
}

// ── 持久化形态 ──────────────────────────────────────────────────

/** 数据库中保存的"一轮"运行 */
export interface ZodiacRun {
  id: string;
  question: string;
  options: GenerationOptions;
  perspectives: ZodiacPerspective[];
  synthesis: ZodiacSynthesis | null;
  favorite: boolean;
  title: string;        // 用户可重命名，默认是问题前 30 字
  createdAt: number;
  updatedAt: number;
  model: string;
  partial: boolean;     // 是否部分生成（缺项时为 true）
}

/** 单星座追问产生的对话消息 */
export interface ZodiacFollowupMessage {
  id: string;
  runId: string;
  sign: ZodiacSign;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

// ── UI 状态 ──────────────────────────────────────────────────────

export type CardStatus = 'pending' | 'streaming' | 'done' | 'failed';

export interface PerspectiveCardState {
  sign: ZodiacSign;
  status: CardStatus;
  perspective?: ZodiacPerspective;
  error?: string;
  /** 渐进式生成时的中间累积（interpretation 已收到的字符） */
  streamedInterpretation?: string;
}

export type SynthesisStatus = 'idle' | 'running' | 'done' | 'failed' | 'skipped';

export interface RunSession {
  runId: string | null;
  question: string;
  options: GenerationOptions;
  cards: PerspectiveCardState[];
  synthesisStatus: SynthesisStatus;
  synthesis?: ZodiacSynthesis;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage?: string;
}

// ── 校验与长度限制 ──────────────────────────────────────────────

export const QUESTION_MIN_LENGTH = 1;
export const QUESTION_MAX_LENGTH = 2000;

export const INTERPRETATION_MAX_LENGTH = 600;
export const FOCUS_MAX_ITEMS = 5;
export const FOCUS_ITEM_MAX_LENGTH = 60;
export const ADVICE_MAX_ITEMS = 5;
export const ADVICE_ITEM_MAX_LENGTH = 80;
export const CAUTION_MAX_LENGTH = 100;

export const SYNTHESIS_CONSENSUS_MIN = 3;
export const SYNTHESIS_CONSENSUS_MAX = 5;
export const SYNTHESIS_DISAGREE_MIN = 2;
export const SYNTHESIS_DISAGREE_MAX = 4;
export const SYNTHESIS_BLINDSPOTS_MIN = 1;
export const SYNTHESIS_BLINDSPOTS_MAX = 3;
export const SYNTHESIS_NEXTSTEPS_MAX = 5;

export const HISTORY_MAX_RUNS = 50;
