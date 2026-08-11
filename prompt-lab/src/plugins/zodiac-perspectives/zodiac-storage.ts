/**
 * 十二星座视角插件 — 持久化层
 *
 * 封装 db/index.ts 的 ZodiacRunRecord / ZodiacFollowupMessageRecord，
 * 提供 UI 友好的接口和默认值。
 */

import {
  dbAppendZodiacFollowupMessage,
  dbClearZodiacFollowupMessages,
  dbDeleteZodiacRun,
  dbGetZodiacRun,
  dbLoadZodiacFollowupMessages,
  dbLoadZodiacRuns,
  dbPruneZodiacRuns,
  dbSaveZodiacRun,
  dbUpdateZodiacRun,
  type ZodiacRunRecord,
  type ZodiacFollowupMessageRecord,
} from '@/db';
import {
  HISTORY_MAX_RUNS,
  ZODIAC_SIGNS,
  type GenerationLength,
  type GenerationMode,
  type GenerationScene,
  type GenerationTone,
  type ZodiacPerspective,
  type ZodiacRun,
  type ZodiacSynthesis,
} from './zodiac-types';

// ── 适配：record ↔ domain ──────────────────────────────────────

const DEFAULT_OPTIONS: Record<string, unknown> = {
  scene: 'general',
  length: 'standard',
  tone: 'gentle',
  includeSynthesis: true,
  mode: 'standard',
};

function recordToRun(record: ZodiacRunRecord): ZodiacRun {
  return {
    id: record.id,
    question: record.question,
    options: normalizeOptions(record.options),
    perspectives: normalizePerspectives(record.perspectives),
    synthesis: normalizeSynthesis(record.synthesis),
    favorite: record.favorite,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    model: record.model,
    partial: record.partial,
  };
}

function runToRecord(run: ZodiacRun): ZodiacRunRecord {
  return {
    id: run.id,
    question: run.question,
    title: run.title,
    options: run.options as unknown as Record<string, unknown>,
    perspectives: run.perspectives as unknown as unknown[],
    synthesis: (run.synthesis ?? null) as unknown,
    favorite: run.favorite,
    partial: run.partial,
    model: run.model,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function normalizeOptions(raw: unknown): ZodiacRun['options'] {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const scenes: readonly GenerationScene[] = ['general', 'work', 'relationship', 'decision', 'creative', 'entertainment'];
  const lengths: readonly GenerationLength[] = ['short', 'standard', 'detailed'];
  const tones: readonly GenerationTone[] = ['rational', 'gentle', 'sharp', 'humorous'];
  const modes: readonly GenerationMode[] = ['fast', 'standard', 'deep'];
  return {
    scene: scenes.includes(base.scene as GenerationScene) ? base.scene as GenerationScene : 'general',
    length: lengths.includes(base.length as GenerationLength) ? base.length as GenerationLength : 'standard',
    tone: tones.includes(base.tone as GenerationTone) ? base.tone as GenerationTone : 'gentle',
    includeSynthesis: base.includeSynthesis !== false,
    mode: modes.includes(base.mode as GenerationMode) ? base.mode as GenerationMode : 'standard',
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function normalizePerspectives(raw: unknown): ZodiacPerspective[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: ZodiacPerspective[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.sign !== 'string' || !(ZODIAC_SIGNS as readonly string[]).includes(value.sign) || seen.has(value.sign)) continue;
    const focus = stringArray(value.focus);
    const advice = stringArray(value.advice);
    if (typeof value.interpretation !== 'string' || !value.interpretation.trim() || !focus.length || !advice.length) continue;
    seen.add(value.sign);
    normalized.push({
      sign: value.sign as ZodiacPerspective['sign'],
      interpretation: value.interpretation.trim(),
      focus,
      advice,
      ...(typeof value.caution === 'string' && value.caution.trim() ? { caution: value.caution.trim() } : {}),
    });
  }
  return normalized.sort((a, b) => ZODIAC_SIGNS.indexOf(a.sign) - ZODIAC_SIGNS.indexOf(b.sign));
}

export function normalizeSynthesis(raw: unknown): ZodiacSynthesis | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const consensus = stringArray(value.consensus);
  const blindSpots = stringArray(value.blindSpots);
  const nextSteps = stringArray(value.nextSteps);
  const disagreements = Array.isArray(value.disagreements)
    ? value.disagreements.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      const positions = stringArray(entry.positions);
      return typeof entry.topic === 'string' && entry.topic.trim() && positions.length >= 2
        ? [{ topic: entry.topic.trim(), positions }]
        : [];
    })
    : [];
  const distinctiveViews = Array.isArray(value.distinctiveViews)
    ? value.distinctiveViews.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      return typeof entry.sign === 'string'
        && (ZODIAC_SIGNS as readonly string[]).includes(entry.sign)
        && typeof entry.difference === 'string'
        && entry.difference.trim()
        ? [{ sign: entry.sign as ZodiacPerspective['sign'], difference: entry.difference.trim() }]
        : [];
    }).slice(0, 5)
    : [];
  return consensus.length && disagreements.length && blindSpots.length && nextSteps.length
    ? { consensus, disagreements, blindSpots, nextSteps, ...(distinctiveViews.length ? { distinctiveViews } : {}) }
    : null;
}

export function defaultTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  return `${cleaned.slice(0, 30)}…`;
}

// ── 公开 API ──────────────────────────────────────────────────

export function saveRun(run: ZodiacRun): void {
  dbSaveZodiacRun(runToRecord(run));
}

export function loadRuns(options: { limit?: number; favoriteOnly?: boolean; search?: string } = {}): ZodiacRun[] {
  return dbLoadZodiacRuns(options).map(recordToRun);
}

export function loadRun(id: string): ZodiacRun | null {
  const record = dbGetZodiacRun(id);
  return record ? recordToRun(record) : null;
}

export function deleteRun(id: string): void {
  dbDeleteZodiacRun(id);
  dbClearZodiacFollowupMessages(id);
}

export function renameRun(id: string, title: string): void {
  dbUpdateZodiacRun(id, { title: title.trim() });
}

export function setFavorite(id: string, favorite: boolean): void {
  dbUpdateZodiacRun(id, { favorite });
}

export function setPartial(id: string, partial: boolean): void {
  dbUpdateZodiacRun(id, { partial });
}

export function updateRunSynthesis(id: string, synthesis: ZodiacRun['synthesis']): void {
  dbUpdateZodiacRun(id, { synthesis });
}

export function updateRunPerspectives(id: string, perspectives: ZodiacRun['perspectives']): void {
  dbUpdateZodiacRun(id, { perspectives });
}

export function pruneOldRuns(): void {
  dbPruneZodiacRuns(HISTORY_MAX_RUNS);
}

export function clearNonFavoriteRuns(): number {
  const all = dbLoadZodiacRuns({ limit: 500 });
  let removed = 0;
  for (const record of all) {
    if (!record.favorite) {
      dbDeleteZodiacRun(record.id);
      removed += 1;
    }
  }
  return removed;
}

export function loadFollowupMessages(runId: string): ZodiacFollowupMessageRecord[] {
  return dbLoadZodiacFollowupMessages(runId);
}

export function appendFollowupMessage(message: ZodiacFollowupMessageRecord): void {
  dbAppendZodiacFollowupMessage(message);
}

export function clearFollowupMessages(runId: string): void {
  dbClearZodiacFollowupMessages(runId);
}

export { DEFAULT_OPTIONS };
