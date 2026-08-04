export interface AiContextFile {
  path: string;
  content: string;
  priority?: number;
}

/** Conservative tokenizer-independent estimate suitable for enforcing a client-side budget. */
export function estimateTokens(value: string): number {
  let units = 0;
  for (const char of value) units += /[\u3400-\u9fff]/u.test(char) ? 1 : 0.28;
  return Math.max(1, Math.ceil(units));
}

export function fitContextToTokenBudget(files: AiContextFile[], tokenBudget: number, reservedTokens = 4_000): { files: AiContextFile[]; estimatedTokens: number; omitted: string[] } {
  const available = Math.max(1_000, tokenBudget - reservedTokens);
  const ranked = [...files].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const selected: AiContextFile[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const file of ranked) {
    const overhead = estimateTokens(file.path) + 12;
    const cost = estimateTokens(file.content) + overhead;
    if (used + cost <= available) {
      selected.push(file);
      used += cost;
      continue;
    }
    const remaining = available - used - overhead;
    if (remaining >= 500 && selected.length === 0) {
      const ratio = Math.min(1, remaining / estimateTokens(file.content));
      const length = Math.max(1, Math.floor(file.content.length * ratio));
      selected.push({ ...file, content: `${file.content.slice(0, length)}\n/* …内容已按 Token 预算压缩… */` });
      used = available;
    } else {
      omitted.push(file.path);
    }
  }
  return { files: selected, estimatedTokens: used + reservedTokens, omitted };
}
