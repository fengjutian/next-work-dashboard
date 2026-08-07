export interface TextDiffHunk {
  index: number;
  originalStart: number;
  originalLines: string[];
  modifiedStart: number;
  modifiedLines: string[];
}

export interface TextComparisonOptions {
  ignoreCase?: boolean;
  ignoreBlankLines?: boolean;
}

type Edit = { type: 'equal' | 'delete' | 'insert'; value: string };

function valueAt(map: Map<number, number>, key: number): number {
  return map.get(key) ?? Number.NEGATIVE_INFINITY;
}

/** Myers line diff. It avoids the repeated-line and fixed-lookahead failures of the old heuristic. */
function lineEdits(original: string[], modified: string[]): Edit[] {
  const max = original.length + modified.length;
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let depth = 0; depth <= max; depth += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = diagonal === -depth
        || (diagonal !== depth && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1))
        ? valueAt(frontier, diagonal + 1)
        : valueAt(frontier, diagonal - 1) + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < original.length && y < modified.length && original[x] === modified[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x < original.length || y < modified.length) continue;

      const edits: Edit[] = [];
      let backX = original.length;
      let backY = modified.length;
      for (let backDepth = depth; backDepth >= 0; backDepth -= 1) {
        const previous = trace[backDepth];
        const backDiagonal = backX - backY;
        const previousDiagonal = backDiagonal === -backDepth
          || (backDiagonal !== backDepth && valueAt(previous, backDiagonal - 1) < valueAt(previous, backDiagonal + 1))
          ? backDiagonal + 1
          : backDiagonal - 1;
        const previousXValue = valueAt(previous, previousDiagonal);
        const previousX = Number.isFinite(previousXValue) ? previousXValue : 0;
        const previousY = previousX - previousDiagonal;
        while (backX > previousX && backY > previousY) {
          edits.push({ type: 'equal', value: original[backX - 1] });
          backX -= 1;
          backY -= 1;
        }
        if (backDepth === 0) break;
        if (backX === previousX) {
          edits.push({ type: 'insert', value: modified[backY - 1] });
          backY -= 1;
        } else {
          edits.push({ type: 'delete', value: original[backX - 1] });
          backX -= 1;
        }
      }
      return edits.reverse();
    }
  }
  return [];
}

export function computeTextDiffHunks(originalText: string, modifiedText: string): TextDiffHunk[] {
  if (originalText === modifiedText) return [];
  const original = originalText.split('\n');
  const modified = modifiedText.split('\n');
  const edits = lineEdits(original, modified);
  const hunks: TextDiffHunk[] = [];
  let originalLine = 1;
  let modifiedLine = 1;
  let current: TextDiffHunk | null = null;

  const flush = () => {
    if (!current) return;
    current.index = hunks.length;
    hunks.push(current);
    current = null;
  };
  for (const edit of edits) {
    if (edit.type === 'equal') {
      flush();
      originalLine += 1;
      modifiedLine += 1;
      continue;
    }
    current ??= {
      index: hunks.length,
      originalStart: originalLine,
      originalLines: [],
      modifiedStart: modifiedLine,
      modifiedLines: [],
    };
    if (edit.type === 'delete') {
      current.originalLines.push(edit.value);
      originalLine += 1;
    } else {
      current.modifiedLines.push(edit.value);
      modifiedLine += 1;
    }
  }
  flush();
  return hunks;
}

export function prepareTextForComparison(text: string, options: TextComparisonOptions = {}): string {
  let lines = text.split('\n');
  if (options.ignoreBlankLines) lines = lines.filter((line) => line.trim().length > 0);
  const prepared = lines.join('\n');
  return options.ignoreCase ? prepared.toLocaleLowerCase() : prepared;
}

export function applyTextDiffHunk(
  original: string,
  modified: string,
  hunk: TextDiffHunk,
  direction: 'left-to-right' | 'right-to-left',
): { original: string; modified: string } {
  if (direction === 'left-to-right') {
    const lines = modified.split('\n');
    lines.splice(hunk.modifiedStart - 1, hunk.modifiedLines.length, ...hunk.originalLines);
    return { original, modified: lines.join('\n') };
  }
  const lines = original.split('\n');
  lines.splice(hunk.originalStart - 1, hunk.originalLines.length, ...hunk.modifiedLines);
  return { original: lines.join('\n'), modified };
}

export function createUnifiedDiff(original: string, modified: string, originalLabel = 'original', modifiedLabel = 'modified', contextLines = 3): string {
  if (original === modified) return '';
  const edits = lineEdits(original.split('\n'), modified.split('\n'));
  const changed = edits.map((edit, index) => edit.type === 'equal' ? -1 : index).filter((index) => index >= 0);
  if (changed.length === 0) return '';
  const context = Math.max(0, Math.floor(contextLines));
  const windows: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(edits.length, index + context + 1);
    const previous = windows[windows.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
  }

  let originalLine = 1;
  let modifiedLine = 1;
  let cursor = 0;
  const output = [`--- ${originalLabel}`, `+++ ${modifiedLabel}`];
  for (const window of windows) {
    while (cursor < window.start) {
      const edit = edits[cursor];
      if (edit.type !== 'insert') originalLine += 1;
      if (edit.type !== 'delete') modifiedLine += 1;
      cursor += 1;
    }
    const originalStart = originalLine;
    const modifiedStart = modifiedLine;
    const block = edits.slice(window.start, window.end);
    const originalCount = block.filter((edit) => edit.type !== 'insert').length;
    const modifiedCount = block.filter((edit) => edit.type !== 'delete').length;
    output.push(`@@ -${originalStart},${originalCount} +${modifiedStart},${modifiedCount} @@`);
    for (const edit of block) {
      output.push(`${edit.type === 'equal' ? ' ' : edit.type === 'delete' ? '-' : '+'}${edit.value}`);
      if (edit.type !== 'insert') originalLine += 1;
      if (edit.type !== 'delete') modifiedLine += 1;
      cursor += 1;
    }
  }
  output.push('');
  return output.join('\n');
}
