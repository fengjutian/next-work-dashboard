/**
 * 极简 Web Diff
 *
 * 不引入 diff-match-patch（重依赖）。Phase 1 用 LCS 行级 diff：
 *  - 输入两段纯文本
 *  - 输出 unified-diff 风格的 hunk 列表
 *
 * Phase 2 可换为 diff-match-patch（更好的字符级 diff）。
 */

export interface DiffHunk {
  kind: 'context' | 'add' | 'remove';
  text: string;
}

/** 行级 LCS diff。O(n*m) 但对小段文本够用。 */
export function lineDiff(a: string, b: string): DiffHunk[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) { hunks.push({ kind: 'context', text: aLines[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { hunks.push({ kind: 'remove', text: aLines[i] }); i++; }
    else { hunks.push({ kind: 'add', text: bLines[j] }); j++; }
  }
  while (i < m) { hunks.push({ kind: 'remove', text: aLines[i++] }); }
  while (j < n) { hunks.push({ kind: 'add', text: bLines[j++] }); }
  return hunks;
}

/** 折叠连续同类 hunk，便于 UI 展示。 */
export function collapseHunks(hunks: DiffHunk[], contextLines = 3): DiffHunk[] {
  const out: DiffHunk[] = [];
  let buf: DiffHunk[] = [];
  const flush = () => {
    if (!buf.length) return;
    const firstChange = buf.findIndex((h) => h.kind !== 'context');
    if (firstChange < 0) {
      out.push({ kind: 'context', text: buf.map((h) => h.text).join('\n') });
    } else {
      const start = Math.max(0, firstChange - contextLines);
      const end = Math.min(buf.length, firstChange + contextLines + 1);
      for (let k = 0; k < start; k++) if (buf[k].kind === 'context') out.push(buf[k]);
      out.push({ kind: 'add', text: buf.slice(start, end).filter((h) => h.kind === 'add').map((h) => '+ ' + h.text).join('\n') || '(empty)' });
      out.push({ kind: 'remove', text: buf.slice(start, end).filter((h) => h.kind === 'remove').map((h) => '- ' + h.text).join('\n') || '(empty)' });
      for (let k = end; k < buf.length; k++) if (buf[k].kind === 'context') out.push(buf[k]);
    }
    buf = [];
  };
  for (const h of hunks) {
    if (h.kind === 'context') { buf.push(h); if (buf.length > contextLines * 2 + 1) flush(); }
    else { buf.push(h); }
  }
  flush();
  return out;
}

/** 一句话总结 diff："+12 / -3 / 7 段" */
export function summarizeDiff(hunks: DiffHunk[]): string {
  let add = 0, remove = 0, changeBlocks = 0;
  let inChange = false;
  for (const h of hunks) {
    if (h.kind === 'add') { add++; if (!inChange) { changeBlocks++; inChange = true; } }
    else if (h.kind === 'remove') { remove++; if (!inChange) { changeBlocks++; inChange = true; } }
    else inChange = false;
  }
  return `+${add} / -${remove} / ${changeBlocks} 段`;
}
