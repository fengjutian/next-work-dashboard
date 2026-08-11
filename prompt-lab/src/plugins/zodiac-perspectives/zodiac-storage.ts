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
import { HISTORY_MAX_RUNS, type ZodiacRun } from './zodiac-types';

// ── 适配：record ↔ domain ──────────────────────────────────────

const DEFAULT_OPTIONS: Record<string, unknown> = {
  scene: 'general',
  length: 'standard',
  tone: 'gentle',
  includeSynthesis: true,
};

function recordToRun(record: ZodiacRunRecord): ZodiacRun {
  return {
    id: record.id,
    question: record.question,
    options: normalizeOptions(record.options),
    perspectives: Array.isArray(record.perspectives) ? (record.perspectives as unknown as ZodiacRun['perspectives']) : [],
    synthesis: (record.synthesis ?? null) as ZodiacRun['synthesis'],
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
  return {
    scene: (base.scene as ZodiacRun['options']['scene']) ?? 'general',
    length: (base.length as ZodiacRun['options']['length']) ?? 'standard',
    tone: (base.tone as ZodiacRun['options']['tone']) ?? 'gentle',
    includeSynthesis: base.includeSynthesis !== false,
  };
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
