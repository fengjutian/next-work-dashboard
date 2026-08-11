import { ZODIAC_SIGNS, type GenerationMode, type GenerationScene, type ZodiacPerspective, type ZodiacSign, type ZodiacSynthesis } from './zodiac-types';
import { detectHighRisk } from './zodiac-prompts';

export type FeedbackKind = 'helpful' | 'repetitive' | 'offPersona' | 'notActionable';
interface FeedbackEvent { kind: FeedbackKind; sign: ZodiacSign; scene: GenerationScene; model: string; at: number }
interface RunMetric { scene: GenerationScene; mode: GenerationMode; durationMs: number; expected: number; parsed: number; fastFallback: boolean; repeatRate: number; at: number }
interface QualityStore { version: 1; feedback: FeedbackEvent[]; runs: RunMetric[] }
const KEY = 'zodiac-quality-v1';

function load(): QualityStore {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as QualityStore | null;
    return value?.version === 1 && Array.isArray(value.feedback) && Array.isArray(value.runs) ? value : { version: 1, feedback: [], runs: [] };
  } catch { return { version: 1, feedback: [], runs: [] }; }
}
function save(value: QualityStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function recordFeedback(event: Omit<FeedbackEvent, 'at'>): void {
  const store = load();
  store.feedback.push({ ...event, at: Date.now() });
  store.feedback = store.feedback.slice(-2000);
  save(store);
}

export function textSimilarity(left: string, right: string): number {
  const tokens = (text: string) => {
    const normalized = text.toLowerCase().replace(/[\s，。！？、；：]+/g, '');
    const items = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) items.add(normalized.slice(index, index + 2));
    return items;
  };
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / (a.size + b.size - intersection);
}

export function calculateRepeatRate(perspectives: ZodiacPerspective[], threshold = 0.65): number {
  let pairs = 0; let repeated = 0;
  for (let i = 0; i < perspectives.length; i += 1) for (let j = i + 1; j < perspectives.length; j += 1) {
    pairs += 1;
    const a = `${perspectives[i].interpretation} ${perspectives[i].advice.join(' ')}`;
    const b = `${perspectives[j].interpretation} ${perspectives[j].advice.join(' ')}`;
    if (textSimilarity(a, b) >= threshold) repeated += 1;
  }
  return pairs ? repeated / pairs : 0;
}

export function recordRunMetric(metric: Omit<RunMetric, 'at' | 'repeatRate'> & { perspectives: ZodiacPerspective[] }): void {
  const store = load();
  const { perspectives, ...anonymousMetric } = metric;
  store.runs.push({ ...anonymousMetric, repeatRate: calculateRepeatRate(perspectives), at: Date.now() });
  store.runs = store.runs.slice(-500);
  save(store);
}

export function getQualityStats() {
  const store = load();
  const bySign = ZODIAC_SIGNS.map((sign) => {
    const events = store.feedback.filter((item) => item.sign === sign);
    return { sign, total: events.length, satisfaction: events.length ? events.filter((item) => item.kind === 'helpful').length / events.length : 0 };
  });
  const scenes = [...new Set(store.runs.map((item) => item.scene))].map((scene) => {
    const runs = store.runs.filter((item) => item.scene === scene);
    return { scene, repeatRate: runs.reduce((sum, item) => sum + item.repeatRate, 0) / runs.length };
  });
  const totalExpected = store.runs.reduce((sum, item) => sum + item.expected, 0);
  const fastRuns = store.runs.filter((item) => item.mode === 'fast');
  return {
    bySign, scenes, runCount: store.runs.length,
    formatSuccessRate: totalExpected ? store.runs.reduce((sum, item) => sum + item.parsed, 0) / totalExpected : 0,
    fastFallbackRate: fastRuns.length ? fastRuns.filter((item) => item.fastFallback).length / fastRuns.length : 0,
    averageDurationMs: store.runs.length ? store.runs.reduce((sum, item) => sum + item.durationMs, 0) / store.runs.length : 0,
  };
}

const ACTION_VERBS = /(检查|比较|列出|询问|沟通|记录|验证|尝试|制定|设定|评估|确认|咨询|停止|开始|拆解|收集|核算|执行|准备|寻找|选择|观察|复盘|练习|明确|避免|保持|考虑|调整|建立|安排|计算)/;
const FATALISM = /(命中注定|注定会|无法改变|天生就是|必然失败|必然成功|一定会)/;
export function evaluatePerspectiveQuality(perspective: ZodiacPerspective) {
  const text = `${perspective.interpretation} ${perspective.focus.join(' ')} ${perspective.advice.join(' ')}`;
  return { hasActionVerb: perspective.advice.some((item) => ACTION_VERBS.test(item)), hasFatalism: FATALISM.test(text) || /[某该这]星座一定/.test(text) };
}
export function hasValidDistinctiveViews(synthesis: ZodiacSynthesis, signs: readonly ZodiacSign[]): boolean {
  return (synthesis.distinctiveViews ?? []).every((item) => signs.includes(item.sign));
}

export function maxPairSimilarity(perspectives: ZodiacPerspective[]): number {
  let maximum = 0;
  for (let i = 0; i < perspectives.length; i += 1) for (let j = i + 1; j < perspectives.length; j += 1) {
    maximum = Math.max(maximum, textSimilarity(
      `${perspectives[i].interpretation} ${perspectives[i].advice.join(' ')}`,
      `${perspectives[j].interpretation} ${perspectives[j].advice.join(' ')}`,
    ));
  }
  return maximum;
}

export function passesHighRiskGate(question: string, output: string): boolean {
  const risk = detectHighRisk(question);
  if (!risk) return true;
  return /(专业|医生|药师|律师|持牌|紧急电话|援助热线|不能替代|不构成)/.test(output);
}
