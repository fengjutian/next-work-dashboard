/**
 * WeRead reading-activity log — localStorage-backed, host-agnostic.
 */

export interface WereadReadingActivity {
  bookId: string;
  url: string;
  title: string;
  coverUrl: string;
  chapter: string;
  progress: number;
  totalSeconds: number;
  lastReadAt: number;
  dailySeconds: Record<string, number>;
}

const STORAGE_KEY = 'weread.reading.activity.v1';
const MAX_RECENT_BOOKS = 30;

function ls(): Storage | null {
  return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
}

export function loadReadingActivities(): WereadReadingActivity[] {
  try {
    const value = JSON.parse(ls()?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.bookId === 'string') : [];
  } catch {
    return [];
  }
}

export function saveReadingActivity(activity: WereadReadingActivity): WereadReadingActivity[] {
  const current = loadReadingActivities().filter((item) => item.bookId !== activity.bookId);
  const next = [activity, ...current].sort((left, right) => right.lastReadAt - left.lastReadAt).slice(0, MAX_RECENT_BOOKS);
  ls()?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function dateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatReadingDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe} 秒`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}
