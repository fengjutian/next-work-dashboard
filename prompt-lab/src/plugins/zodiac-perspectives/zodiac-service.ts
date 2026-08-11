/**
 * 十二星座视角插件 — AI 服务层
 *
 * 职责：
 * 1. 拼装 messages 并调用 LLM provider
 * 2. 解析并校验模型输出（处理围栏、裸 JSON、缺字段等情况）
 * 3. 12 星座并行生成 + 独立汇总生成（混合模式）
 * 4. 失败重试 1 次 + 部分项保留
 * 5. 单星座追问：保留原问题与本轮回答作 system
 *
 * 设计原则：
 * - 不强依赖 responseFormat: 'json_object'（不是所有 OpenAI 兼容服务都支持）
 * - 所有面向用户的字符串做最小清洗：去控制字符 + 截断长度
 * - 服务层不直接渲染或持久化，只返回结构化数据；UI 与 DB 各自负责
 */

import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import {
  ZODIAC_SIGNS,
  type GenerationOptions,
  type ZodiacPerspective,
  type ZodiacPerspectiveResult,
  type ZodiacSign,
  type ZodiacSynthesis,
  type QuestionContext,
} from './zodiac-types';
import { ZODIAC_META } from './zodiac-data';
import {
  COMMON_SYSTEM_PROMPT,
  buildFollowupSystemPrompt,
  buildFastBatchUserPrompt,
  buildQuestionContextPrompt,
  buildSingleSignUserPrompt,
  buildSynthesisUserPrompt,
  detectHighRisk,
} from './zodiac-prompts';
import {
  ADVICE_ITEM_MAX_LENGTH,
  ADVICE_MAX_ITEMS,
  CAUTION_MAX_LENGTH,
  FOCUS_ITEM_MAX_LENGTH,
  FOCUS_MAX_ITEMS,
  INTERPRETATION_MAX_LENGTH,
  SYNTHESIS_BLINDSPOTS_MAX,
  SYNTHESIS_BLINDSPOTS_MIN,
  SYNTHESIS_CONSENSUS_MAX,
  SYNTHESIS_CONSENSUS_MIN,
  SYNTHESIS_DISAGREE_MAX,
  SYNTHESIS_DISAGREE_MIN,
  SYNTHESIS_NEXTSTEPS_MAX,
} from './zodiac-types';

// ── 输入接口 ─────────────────────────────────────────────────────

export interface GenerateContext {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface PerspectiveProgress {
  sign: ZodiacSign;
  /** 累积的解释文本（流式增量） */
  streamedInterpretation: string;
}

export interface GenerateCallbacks {
  /** 每张卡片刚开始生成 */
  onCardStart?: (sign: ZodiacSign) => void;
  /** 每张卡片流式到达一段字符（用于即时反馈） */
  onCardStream?: (progress: PerspectiveProgress) => void;
  /** 单张卡片完成且解析成功 */
  onCardDone?: (sign: ZodiacSign, perspective: ZodiacPerspective) => void;
  /** 单张卡片失败 */
  onCardFailed?: (sign: ZodiacSign, error: string) => void;
  /** 全部 12 张完成后开始汇总 */
  onSynthesisStart?: () => void;
  /** 汇总完成 */
  onSynthesisDone?: (synthesis: ZodiacSynthesis) => void;
  /** 汇总失败 */
  onSynthesisFailed?: (error: string) => void;
  /** 任意一次性错误（如 AI 未配置） */
  onFatalError?: (error: string) => void;
}

export interface GenerateResult {
  perspectives: ZodiacPerspective[];
  synthesis: ZodiacSynthesis | null;
  partialSigns: ZodiacSign[];   // 因失败缺失的星座
  warnings: string[];
}

/** 默认最多同时占用 4 个模型请求，避免常见兼容服务触发限流。 */
export const DEFAULT_GENERATION_CONCURRENCY = 4;

export async function allSettledWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = DEFAULT_GENERATION_CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency), tasks.length || 1));
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

// ── JSON 抽取与解析 ──────────────────────────────────────────────

/** 抽取模型输出里的 JSON 片段（兼容 ```json``` 围栏、裸 JSON、带噪声） */
export function extractJson(raw: string): unknown {
  if (!raw) throw new Error('模型没有返回任何内容');
  // 1) 优先取 ```json ... ``` 围栏
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : raw;
  // 2) 取最外层 {...} 区间
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('模型没有返回可解析的 JSON 对象');
  }
  body = body.slice(firstBrace, lastBrace + 1);
  return JSON.parse(body);
}

/** 去除不可见控制字符（保留 \n / \r / \t） */
function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function clip(value: string, max: number): string {
  const cleaned = sanitizeText(value);
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max);
}

function toStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = clip(item, maxItemLength);
    if (!cleaned) continue;
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ── 单星座输出校验 ──────────────────────────────────────────────

export function parsePerspective(raw: string, expectedSign: ZodiacSign): ZodiacPerspective {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模型返回的不是 JSON 对象');
  }
  const obj = parsed as Record<string, unknown>;
  const interpretation = typeof obj.interpretation === 'string' ? clip(obj.interpretation, INTERPRETATION_MAX_LENGTH) : '';
  if (!interpretation) throw new Error('缺少 interpretation 字段或为空');
  const focus = toStringArray(obj.focus, FOCUS_MAX_ITEMS, FOCUS_ITEM_MAX_LENGTH);
  if (focus.length === 0) throw new Error('缺少 focus 字段或为空');
  const advice = toStringArray(obj.advice, ADVICE_MAX_ITEMS, ADVICE_ITEM_MAX_LENGTH);
  if (advice.length === 0) throw new Error('缺少 advice 字段或为空');
  let caution: string | undefined;
  if (typeof obj.caution === 'string') {
    const cleaned = clip(obj.caution, CAUTION_MAX_LENGTH);
    if (cleaned) caution = cleaned;
  }
  return { sign: expectedSign, interpretation, focus, advice, caution };
}

// ── 汇总输出校验 ──────────────────────────────────────────────

export function parseSynthesis(raw: string): ZodiacSynthesis {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('汇总返回的不是 JSON 对象');
  }
  const obj = parsed as Record<string, unknown>;
  const consensus = toStringArray(obj.consensus, SYNTHESIS_CONSENSUS_MAX, 200);
  if (consensus.length < SYNTHESIS_CONSENSUS_MIN) {
    throw new Error(`汇总共识至少需要 ${SYNTHESIS_CONSENSUS_MIN} 条，实际 ${consensus.length} 条`);
  }
  const rawDisagreements = Array.isArray(obj.disagreements) ? obj.disagreements : [];
  const disagreements: ZodiacSynthesis['disagreements'] = [];
  for (const entry of rawDisagreements) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const topic = typeof e.topic === 'string' ? clip(e.topic, 60) : '';
    const positions = toStringArray(e.positions, 4, 200);
    if (topic && positions.length >= 2) {
      disagreements.push({ topic, positions });
    }
    if (disagreements.length >= SYNTHESIS_DISAGREE_MAX) break;
  }
  if (disagreements.length < SYNTHESIS_DISAGREE_MIN) {
    throw new Error(`汇总分歧至少需要 ${SYNTHESIS_DISAGREE_MIN} 组，实际 ${disagreements.length} 组`);
  }
  const blindSpots = toStringArray(obj.blindSpots, SYNTHESIS_BLINDSPOTS_MAX, 200);
  if (blindSpots.length < SYNTHESIS_BLINDSPOTS_MIN) {
    throw new Error(`汇总盲点至少需要 ${SYNTHESIS_BLINDSPOTS_MIN} 条，实际 ${blindSpots.length} 条`);
  }
  const nextSteps = toStringArray(obj.nextSteps, SYNTHESIS_NEXTSTEPS_MAX, 200);
  if (nextSteps.length < 1) {
    throw new Error('汇总缺少 nextSteps 建议');
  }
  const distinctiveViews: NonNullable<ZodiacSynthesis['distinctiveViews']> = [];
  const seenSigns = new Set<ZodiacSign>();
  if (Array.isArray(obj.distinctiveViews)) {
    for (const item of obj.distinctiveViews) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.sign !== 'string' || !(ZODIAC_SIGNS as readonly string[]).includes(entry.sign)) continue;
      if (seenSigns.has(entry.sign as ZodiacSign) || typeof entry.difference !== 'string') continue;
      const difference = clip(entry.difference, 160);
      if (!difference) continue;
      seenSigns.add(entry.sign as ZodiacSign);
      distinctiveViews.push({ sign: entry.sign as ZodiacSign, difference });
      if (distinctiveViews.length >= 5) break;
    }
  }
  return { consensus, disagreements, blindSpots, nextSteps, ...(distinctiveViews.length ? { distinctiveViews } : {}) };
}

// ── 流式输出累积 ──────────────────────────────────────────────

async function collectStream(
  messages: ChatMessage[],
  options: { model: string; temperature?: number; maxTokens?: number; signal?: AbortSignal },
  ctx: GenerateContext,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const provider = createOpenAIProvider({ apiKey: ctx.apiKey, baseUrl: ctx.baseUrl });
  let raw = '';
  for await (const chunk of provider.chat(messages, { ...options, stream: true })) {
    if (chunk.delta) {
      raw += chunk.delta;
      onDelta?.(chunk.delta);
    }
  }
  return raw;
}

export function parseFastBatch(raw: string, expectedSigns: readonly ZodiacSign[] = ZODIAC_SIGNS): ZodiacPerspective[] {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('快速模式返回的不是 JSON 对象');
  const items = (parsed as Record<string, unknown>).perspectives;
  if (!Array.isArray(items)) throw new Error('快速模式缺少 perspectives 数组');
  const bySign = new Map<ZodiacSign, ZodiacPerspective>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const sign = (item as Record<string, unknown>).sign;
    if (typeof sign !== 'string' || !(ZODIAC_SIGNS as readonly string[]).includes(sign)) continue;
    if (!bySign.has(sign as ZodiacSign)) {
      try {
        bySign.set(sign as ZodiacSign, parsePerspective(JSON.stringify(item), sign as ZodiacSign));
      } catch {
        // 保留其他合法项，缺失项稍后走单星座补全。
      }
    }
  }
  if (bySign.size === 0) throw new Error('快速模式没有返回有效视角');
  return expectedSigns.flatMap((sign) => bySign.has(sign) ? [bySign.get(sign)!] : []);
}

function parseQuestionContext(raw: string): QuestionContext {
  const parsed = extractJson(raw) as Record<string, unknown>;
  return {
    knownFacts: toStringArray(parsed.knownFacts, 5, 160),
    goals: toStringArray(parsed.goals, 5, 160),
    constraints: toStringArray(parsed.constraints, 5, 160),
    assumptions: toStringArray(parsed.assumptions, 5, 160),
    missingInformation: toStringArray(parsed.missingInformation, 5, 160),
  };
}

async function generateQuestionContext(question: string, ctx: GenerateContext, signal?: AbortSignal): Promise<QuestionContext> {
  const raw = await collectStream([
    { role: 'system', content: '你是事实整理器。区分用户明确事实、目标、约束、假设和缺失信息，只输出 JSON。' },
    { role: 'user', content: buildQuestionContextPrompt(question) },
  ], { model: ctx.model, temperature: 0.1, maxTokens: 700, signal }, ctx);
  return parseQuestionContext(raw);
}

async function generateFastBatch(
  question: string,
  options: GenerationOptions,
  ctx: GenerateContext,
  signal?: AbortSignal,
): Promise<ZodiacPerspective[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: COMMON_SYSTEM_PROMPT },
    { role: 'user', content: buildFastBatchUserPrompt(question, options) },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return parseFastBatch(await collectStream(messages, { model: ctx.model, temperature: 0.75, maxTokens: 3200, signal }, ctx), options.selectedSigns);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0 && isTransientLlmError(error)) await waitForRetry(attempt, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isTransientLlmError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /LLM API error (408|409|425|429|5\d\d)\b/i.test(error.message)
    || /\b(timeout|timed out|network|fetch failed|ECONNRESET|ETIMEDOUT)\b/i.test(error.message);
}

export function describeLlmError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/LLM API error 401|LLM API error 403/i.test(message)) return 'AI 服务鉴权失败，请检查 API Key 和服务权限。';
  if (/LLM API error 429/i.test(message)) return 'AI 服务请求过于频繁，自动重试后仍未成功，请稍后再试。';
  if (/LLM API error 5\d\d/i.test(message)) return 'AI 服务暂时不可用，请稍后重试。';
  if (/timeout|timed out|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message)) return '网络连接异常或请求超时，请检查网络后重试。';
  if (/JSON|interpretation|perspectives|汇总.*(?:缺少|至少)/i.test(message)) return `AI 输出格式不完整：${message}`;
  return message;
}

async function waitForRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(4_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 200);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('生成已取消', 'AbortError'));
    }, { once: true });
  });
}

// ── 单次单星座生成（含 1 次自动重试） ──────────────────────

export async function generatePerspective(
  sign: ZodiacSign,
  question: string,
  options: GenerationOptions,
  ctx: GenerateContext,
  signal: AbortSignal | undefined,
  onDelta?: (delta: string) => void,
  context?: QuestionContext,
): Promise<ZodiacPerspective> {
  const messages: ChatMessage[] = [
    { role: 'system', content: COMMON_SYSTEM_PROMPT },
    { role: 'user', content: buildSingleSignUserPrompt(question, options, sign, context) },
  ];
  const baseOpts = {
    model: ctx.model,
    temperature: 0.85,
    maxTokens: 700,
    signal,
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw new DOMException('生成已取消', 'AbortError');
    try {
      const raw = await collectStream(messages, baseOpts, ctx, onDelta);
      return parsePerspective(raw, sign);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0 && isTransientLlmError(error)) await waitForRetry(attempt, signal);
      // 第二次尝试：把系统 prompt 里加一句"只输出 JSON，不要任何解释"
      if (attempt === 0) {
        messages[0] = {
          role: 'system',
          content: `${COMMON_SYSTEM_PROMPT}\n\n严格只输出一个合法 JSON 对象，不要任何前后解释、Markdown 围栏或代码块标记。`,
        };
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ── 汇总生成（独立请求，含 1 次自动重试） ──────────────────────

export async function regenerateSynthesis(
  question: string,
  options: GenerationOptions,
  perspectives: ZodiacPerspective[],
  ctx: GenerateContext,
  signal: AbortSignal | undefined,
): Promise<ZodiacSynthesis> {
  const messages: ChatMessage[] = [
    { role: 'system', content: COMMON_SYSTEM_PROMPT },
    { role: 'user', content: buildSynthesisUserPrompt(question, options, perspectives) },
  ];
  const baseOpts = {
    model: ctx.model,
    temperature: 0.5,
    maxTokens: 1500,
    signal,
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw new DOMException('生成已取消', 'AbortError');
    try {
      const raw = await collectStream(messages, baseOpts, ctx);
      return parseSynthesis(raw);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0 && isTransientLlmError(error)) await waitForRetry(attempt, signal);
      if (attempt === 0) {
        messages[0] = {
          role: 'system',
          content: `${COMMON_SYSTEM_PROMPT}\n\n严格只输出一个合法 JSON 对象，不要任何前后解释、Markdown 围栏或代码块标记。`,
        };
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ── 12 路并行 + 独立汇总（混合模式主入口） ──────────────────────

export async function generateAllPerspectives(
  question: string,
  options: GenerationOptions,
  ctx: GenerateContext,
  callbacks: GenerateCallbacks = {},
  signal?: AbortSignal,
): Promise<GenerateResult> {
  if (!ctx.apiKey?.trim() || !ctx.baseUrl?.trim() || !ctx.model?.trim()) {
    const err = '请先在工作台设置中配置 AI 服务、API Key 和模型';
    callbacks.onFatalError?.(err);
    throw new Error(err);
  }

  const highRisk = detectHighRisk(question);
  const warnings: string[] = [];
  if (highRisk) {
    warnings.push(`检测到「${highRisk.category}」类高风险问题：${highRisk.guidance}`);
  }

  if (options.mode === 'fast') {
    for (const sign of options.selectedSigns) callbacks.onCardStart?.(sign);
    try {
      const batch = await generateFastBatch(question, options, ctx, signal);
      const completed = new Map(batch.map((item) => [item.sign, item]));
      for (const perspective of batch) callbacks.onCardDone?.(perspective.sign, perspective);
      const missing = options.selectedSigns.filter((sign) => !completed.has(sign));
      if (missing.length) warnings.push(`快速模式缺少 ${missing.length} 个视角，已自动逐项补全`);
      const supplemental = await allSettledWithConcurrency(missing.map((sign) => async () => {
        const perspective = await generatePerspective(sign, question, options, ctx, signal);
        callbacks.onCardDone?.(sign, perspective);
        return perspective;
      }));
      supplemental.forEach((result, index) => {
        if (result.status === 'fulfilled') completed.set(result.value.sign, result.value);
        else callbacks.onCardFailed?.(missing[index], describeLlmError(result.reason));
      });
      const perspectives = options.selectedSigns.flatMap((sign) => completed.has(sign) ? [completed.get(sign)!] : []);
      const partialSigns = options.selectedSigns.filter((sign) => !completed.has(sign));
      return { perspectives, synthesis: null, partialSigns, warnings };
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      for (const sign of options.selectedSigns) callbacks.onCardFailed?.(sign, message);
      throw error;
    }
  }

  let sharedContext: QuestionContext | undefined;
  try {
    sharedContext = await generateQuestionContext(question, ctx, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    warnings.push('共享事实摘要生成失败，已使用原问题继续生成');
  }

  const tasks = options.selectedSigns.map((sign) => async (): Promise<{ sign: ZodiacSign; perspective: ZodiacPerspective }> => {
    if (signal?.aborted) throw new DOMException('生成已取消', 'AbortError');
    callbacks.onCardStart?.(sign);
    try {
      const perspective = await generatePerspective(
        sign,
        question,
        options,
        ctx,
        signal,
        (delta) => callbacks.onCardStream?.({ sign, streamedInterpretation: delta }),
        sharedContext,
      );
      callbacks.onCardDone?.(sign, perspective);
      return { sign, perspective };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onCardFailed?.(sign, message);
      throw error;
    }
  });

  const settled = await allSettledWithConcurrency(tasks);

  // allSettled 会吸收 AbortError；必须在汇总失败项前恢复取消语义。
  if (signal?.aborted) {
    throw new DOMException('生成已取消', 'AbortError');
  }

  const perspectives: ZodiacPerspective[] = [];
  const partialSigns: ZodiacSign[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const sign = options.selectedSigns[i];
    if (result.status === 'fulfilled') {
      perspectives.push(result.value.perspective);
    } else {
      partialSigns.push(sign);
    }
  }

  // 按黄道顺序排序
  perspectives.sort((a, b) => ZODIAC_SIGNS.indexOf(a.sign) - ZODIAC_SIGNS.indexOf(b.sign));

  let synthesis: ZodiacSynthesis | null = null;
  if (options.includeSynthesis) {
    if (perspectives.length < 4) {
      // 视角太少，汇总没意义
      warnings.push('成功视角不足 4 个，已跳过汇总');
    } else {
      callbacks.onSynthesisStart?.();
      try {
        synthesis = await regenerateSynthesis(question, options, perspectives, ctx, signal);
        callbacks.onSynthesisDone?.(synthesis);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        callbacks.onSynthesisFailed?.(message);
        warnings.push(`汇总生成失败：${message}`);
      }
    }
  }

  return { perspectives, synthesis, partialSigns, warnings };
}

// ── 单星座追问（保留上下文，system = 原问题 + 原回答） ──────────

export interface FollowupTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function generateFollowup(
  originalQuestion: string,
  originalAnswer: ZodiacPerspective,
  sign: ZodiacSign,
  history: FollowupTurn[],
  newUserMessage: string,
  ctx: GenerateContext,
  signal?: AbortSignal,
): Promise<string> {
  if (!ctx.apiKey?.trim() || !ctx.baseUrl?.trim() || !ctx.model?.trim()) {
    throw new Error('请先在工作台设置中配置 AI 服务、API Key 和模型');
  }
  if (!newUserMessage.trim()) throw new Error('追问内容不能为空');

  const meta = ZODIAC_META[sign];
  const systemContent = buildFollowupSystemPrompt(sign, originalQuestion, originalAnswer);
  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];
  // 限制历史长度，避免 system 太大：保留最近 6 轮
  const recent = history.slice(-12);
  for (const turn of recent) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: 'user', content: newUserMessage.trim() });

  const provider = createOpenAIProvider({ apiKey: ctx.apiKey, baseUrl: ctx.baseUrl });
  let raw = '';
  for await (const chunk of provider.chat(messages, { model: ctx.model, temperature: 0.8, maxTokens: 600, signal, stream: true })) {
    if (chunk.delta) raw += chunk.delta;
  }
  const cleaned = sanitizeText(raw);
  if (!cleaned) throw new Error(`${meta.name} 视角没有返回内容，请重试`);
  return cleaned;
}

// ── 校验：12 项 + sign 唯一（用于历史载入后做防御） ──────────────

export function isValidPerspectiveArray(value: unknown): value is ZodiacPerspective[] {
  if (!Array.isArray(value) || value.length !== 12) return false;
  const seen = new Set<ZodiacSign>();
  for (const item of value) {
    if (!item || typeof item !== 'object') return false;
    const p = item as Partial<ZodiacPerspective>;
    if (!p.sign || !(ZODIAC_SIGNS as readonly string[]).includes(p.sign)) return false;
    if (seen.has(p.sign as ZodiacSign)) return false;
    seen.add(p.sign as ZodiacSign);
    if (typeof p.interpretation !== 'string' || !p.interpretation) return false;
    if (!Array.isArray(p.focus) || !p.focus.length) return false;
    if (!Array.isArray(p.advice) || !p.advice.length) return false;
  }
  return true;
}

export function isValidSynthesis(value: unknown): value is ZodiacSynthesis {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<ZodiacSynthesis>;
  return Array.isArray(s.consensus) && s.consensus.length >= 1
    && Array.isArray(s.disagreements) && s.disagreements.length >= 1
    && Array.isArray(s.blindSpots) && s.blindSpots.length >= 1
    && Array.isArray(s.nextSteps) && s.nextSteps.length >= 1;
}

export function buildResult(
  question: string,
  result: GenerateResult,
): ZodiacPerspectiveResult {
  return {
    question,
    perspectives: result.perspectives,
    synthesis: result.synthesis ?? undefined,
  };
}
