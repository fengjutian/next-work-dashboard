import type { ThinkingRun } from './thinking-types';

const KEY = 'prompt-lab:thinking-lab:runs:v1';
const MAX_RUNS = 40;

export function loadThinkingRuns(): ThinkingRun[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, MAX_RUNS) as ThinkingRun[] : [];
  } catch {
    return [];
  }
}

export function saveThinkingRun(run: ThinkingRun): void {
  const next = [run, ...loadThinkingRuns().filter((item) => item.id !== run.id)].slice(0, MAX_RUNS);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function deleteThinkingRun(id: string): ThinkingRun[] {
  const next = loadThinkingRuns().filter((item) => item.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
