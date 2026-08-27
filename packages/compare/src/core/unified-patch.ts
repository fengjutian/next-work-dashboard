export interface UnifiedPatchLine {
  type: 'context' | 'add' | 'remove';
  value: string;
}

export interface UnifiedPatchHunk {
  originalStart: number;
  originalCount: number;
  modifiedStart: number;
  modifiedCount: number;
  lines: UnifiedPatchLine[];
}

export interface UnifiedPatch {
  originalLabel: string;
  modifiedLabel: string;
  hunks: UnifiedPatchHunk[];
}

export interface PatchApplyResult {
  success: boolean;
  content: string;
  appliedHunks: number;
  failedHunk?: number;
  error?: string;
}

function parseRange(value: string | undefined): number {
  return value === undefined ? 1 : Number(value);
}

export function parseUnifiedPatch(text: string): UnifiedPatch {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const originalHeader = lines.findIndex((line) => line.startsWith('--- '));
  const modifiedHeader = originalHeader >= 0 ? lines.findIndex((line, index) => index > originalHeader && line.startsWith('+++ ')) : -1;
  if (originalHeader < 0 || modifiedHeader < 0) throw new Error('PATCH_HEADERS_MISSING');
  const patch: UnifiedPatch = {
    originalLabel: lines[originalHeader].slice(4).trim(),
    modifiedLabel: lines[modifiedHeader].slice(4).trim(),
    hunks: [],
  };
  const headerPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  let index = modifiedHeader + 1;
  while (index < lines.length) {
    if (!lines[index].startsWith('@@')) { index += 1; continue; }
    const match = headerPattern.exec(lines[index]);
    if (!match) throw new Error(`PATCH_HUNK_HEADER_INVALID:${index + 1}`);
    const hunk: UnifiedPatchHunk = {
      originalStart: Number(match[1]),
      originalCount: parseRange(match[2]),
      modifiedStart: Number(match[3]),
      modifiedCount: parseRange(match[4]),
      lines: [],
    };
    index += 1;
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const line = lines[index];
      if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) break;
      if (line.startsWith('\\ No newline at end of file')) { index += 1; continue; }
      if (line.startsWith(' ')) hunk.lines.push({ type: 'context', value: line.slice(1) });
      else if (line.startsWith('+')) hunk.lines.push({ type: 'add', value: line.slice(1) });
      else if (line.startsWith('-')) hunk.lines.push({ type: 'remove', value: line.slice(1) });
      else if (line !== '' || index < lines.length - 1) throw new Error(`PATCH_LINE_INVALID:${index + 1}`);
      index += 1;
    }
    const originalCount = hunk.lines.filter((line) => line.type !== 'add').length;
    const modifiedCount = hunk.lines.filter((line) => line.type !== 'remove').length;
    if (originalCount !== hunk.originalCount || modifiedCount !== hunk.modifiedCount) throw new Error(`PATCH_HUNK_COUNT_MISMATCH:${patch.hunks.length + 1}`);
    patch.hunks.push(hunk);
  }
  if (patch.hunks.length === 0) throw new Error('PATCH_HUNKS_MISSING');
  return patch;
}

export function applyUnifiedPatch(source: string, patch: UnifiedPatch, reverse = false): PatchApplyResult {
  const sourceLines = source.split('\n');
  const output = [...sourceLines];
  let offset = 0;
  for (let index = 0; index < patch.hunks.length; index += 1) {
    const hunk = patch.hunks[index];
    const start = (reverse ? hunk.modifiedStart : hunk.originalStart) - 1 + offset;
    const inputTypes = reverse ? new Set(['context', 'add']) : new Set(['context', 'remove']);
    const outputTypes = reverse ? new Set(['context', 'remove']) : new Set(['context', 'add']);
    const expected = hunk.lines.filter((line) => inputTypes.has(line.type)).map((line) => line.value);
    const replacement = hunk.lines.filter((line) => outputTypes.has(line.type)).map((line) => line.value);
    if (start < 0 || start + expected.length > output.length) {
      return { success: false, content: source, appliedHunks: index, failedHunk: index, error: 'PATCH_RANGE_MISMATCH' };
    }
    const actual = output.slice(start, start + expected.length);
    const mismatch = expected.findIndex((line, lineIndex) => line !== actual[lineIndex]);
    if (mismatch >= 0) {
      return { success: false, content: source, appliedHunks: index, failedHunk: index, error: `PATCH_CONTEXT_MISMATCH:${start + mismatch + 1}` };
    }
    output.splice(start, expected.length, ...replacement);
    offset += replacement.length - expected.length;
  }
  return { success: true, content: output.join('\n'), appliedHunks: patch.hunks.length };
}

