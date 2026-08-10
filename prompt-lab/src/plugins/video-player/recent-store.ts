/**
 * 最近播放列表 — 渲染进程本地存储
 *
 * 存储在 localStorage 中，key = `video-player.recent.v1`。
 * 最多保留 16 条，最近播放排在前。
 */

import type { RecentVideoEntry } from './types';

const STORAGE_KEY = 'video-player.recent.v1';
const MAX_ENTRIES = 16;

function readRaw(): RecentVideoEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentVideoEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentVideoEntry =>
        typeof e?.path === 'string' && typeof e?.name === 'string' && typeof e?.lastPlayedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: RecentVideoEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore quota errors
  }
}

export function loadRecent(): RecentVideoEntry[] {
  return readRaw();
}

export function recordRecent(entry: RecentVideoEntry): RecentVideoEntry[] {
  const current = readRaw().filter((e) => e.path !== entry.path);
  const next = [{ ...entry }, ...current].slice(0, MAX_ENTRIES);
  writeRaw(next);
  return next;
}

export function removeRecent(path: string): RecentVideoEntry[] {
  const next = readRaw().filter((e) => e.path !== path);
  writeRaw(next);
  return next;
}

export function clearRecent(): void {
  writeRaw([]);
}
