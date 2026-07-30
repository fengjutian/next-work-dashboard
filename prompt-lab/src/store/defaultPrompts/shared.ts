import type { Prompt } from '../types';

const now = Date.now();
const DAY = 86_400_000;
export const daysAgo = (n: number) => now - DAY * n;
