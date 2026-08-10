/**
 * roundtrip-guard — 把 Markdown 文本切分为"安全段"和"受保护段"。
 *
 * 触发受保护的语法清单（按检测顺序）：
 *   1. 围栏代码块（fenced code）：暂时一律视为受保护，因为低亮语言清单可能未覆盖。
 *      P0 阶段保守策略；后续会放行常见语言。
 *   2. 缩进代码块：暂作受保护（很少用，可后续优化）。
 *   3. MDX import/export 语句
 *   4. MDX JSX 元素：`<Foo>`、`<Foo />`、`<Foo>...</Foo>`
 *   5. MDX 表达式：`{someExpr}`
 *   6. 未知指令：`:::unknown-block` 等
 *   7. 整段 HTML block（GitHub 风格 <div>...</div> 多行块）
 *   8. HTML 注释：`<!-- ... -->`
 *
 * 其余标准 GFM（标题、列表、任务、表格、链接、图片、引用、强调、删除线、围栏代码）默认安全。
 *
 * 输出：GuardedMarkdown = { segments, protectedBlocks, reasons }
 *   - segments 是 alternating 序列：safe(text) | protected(index)
 *   - reasons 聚合了所有触发原因（用于 UI 提示）
 */

import { createProtectedBlockToken, type ProtectedBlock, type ProtectedBlockReason } from './protected-blocks';

/** 段。 */
export type GuardedSegment = { kind: 'safe'; text: string } | { kind: 'protected'; index: number };

/** 检测结果。 */
export interface GuardedMarkdown {
  segments: GuardedSegment[];
  protectedBlocks: ProtectedBlock[];
  /** 聚合的触发原因集合（去重）。 */
  reasons: ProtectedBlockReason[];
}

interface GuardState {
  blocks: ProtectedBlock[];
  reasons: Set<ProtectedBlockReason>;
}

const FENCE_PATTERN = /^(```|~~~)/;
const FENCE_LANG_PATTERN = /^(```|~~~)\s*([A-Za-z0-9_+-]*)/;
const HTML_BLOCK_OPEN_TAGS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'details', 'summary', 'pre', 'style', 'script']);
const INLINE_HTML_TAGS = new Set(['a', 'span', 'kbd', 'mark', 'sub', 'sup', 'abbr', 'time']);
const MDX_IMPORT_PATTERN = /^\s*import\s+.+\s+from\s+['"][^'"]+['"]\s*;?\s*$/;
const MDX_EXPORT_PATTERN = /^\s*export\s+(const|let|var|function|default|\{)/;
const MDX_EXPRESSION_PATTERN = /^\s*\{[\s\S]+?\}\s*$/;
const DIRECTIVE_PATTERN = /^(:::[A-Za-z][\w-]*)(?:\s+\{[^}]*\})?/;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/;

export function roundtripGuard(body: string): GuardedMarkdown {
  const state: GuardState = { blocks: [], reasons: new Set() };
  const lines = body.split(/\r?\n/);
  const segments: GuardedSegment[] = [];
  let safeBuffer: string[] = [];

  const flushSafe = () => {
    if (safeBuffer.length === 0) return;
    segments.push({ kind: 'safe', text: safeBuffer.join('\n') });
    safeBuffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 1;

    // 1) 围栏代码块：到下一个同样标记的行为止
    if (FENCE_PATTERN.test(line)) {
      const langMatch = line.match(FENCE_LANG_PATTERN);
      const fenceChar = langMatch?.[1] ?? '```';
      const startLine = lineNo;
      const collected = [line];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        collected.push(lines[j]);
        if (lines[j].startsWith(fenceChar) && lines[j].trim() === fenceChar) {
          j += 1;
          break;
        }
        // 文件没有闭合 fence —— 把剩余全部算作受保护。
        if (j === lines.length - 1) {
          j = lines.length;
          break;
        }
      }
      flushSafe();
      pushProtectedBlock(state, collected.join('\n'), 'html-block', startLine); // 复用 html-block 标识
      i = j;
      continue;
    }

    // 2) MDX import
    if (MDX_IMPORT_PATTERN.test(line)) {
      flushSafe();
      pushProtectedBlock(state, line + '\n', 'mdx-import', lineNo);
      i += 1;
      continue;
    }

    // 3) MDX export
    if (MDX_EXPORT_PATTERN.test(line)) {
      flushSafe();
      pushProtectedBlock(state, line + '\n', 'mdx-export', lineNo);
      i += 1;
      continue;
    }

    // 4) MDX 表达式（单行）
    if (MDX_EXPRESSION_PATTERN.test(line) && /^\{.*\}$/.test(line.trim())) {
      flushSafe();
      pushProtectedBlock(state, line + '\n', 'mdx-expression', lineNo);
      i += 1;
      continue;
    }

    // 5) 未知指令
    if (DIRECTIVE_PATTERN.test(line.trim())) {
      flushSafe();
      pushProtectedBlock(state, line + '\n', 'directive-unknown', lineNo);
      i += 1;
      continue;
    }

    // 6) HTML 注释
    if (HTML_COMMENT_PATTERN.test(line)) {
      flushSafe();
      pushProtectedBlock(state, line + '\n', 'html-comment', lineNo);
      i += 1;
      continue;
    }

    // 7) HTML block 起始：识别为多行块
    const blockOpen = line.match(/^<\s*([A-Za-z][A-Za-z0-9-]*)/);
    if (blockOpen && HTML_BLOCK_OPEN_TAGS.has(blockOpen[1].toLowerCase())) {
      const tag = blockOpen[1].toLowerCase();
      const closing = new RegExp(`</\\s*${tag}\\s*>`, 'i');
      const collected = [line];
      const startLine = lineNo;
      let j = i + 1;
      let found = line.includes(`</${tag}>`);
      while (j < lines.length && !found) {
        collected.push(lines[j]);
        if (closing.test(lines[j])) found = true;
        j += 1;
        if (j - i > 50) break; // 防御：HTML 块不超过 50 行
      }
      flushSafe();
      pushProtectedBlock(state, collected.join('\n'), 'html-block', startLine);
      i = j;
      continue;
    }

    safeBuffer.push(line);
    i += 1;
  }

  flushSafe();
  return { segments, protectedBlocks: state.blocks, reasons: [...state.reasons] };
}

function pushProtectedBlock(state: GuardState, raw: string, reason: ProtectedBlockReason, startLine: number): void {
  const index = state.blocks.length;
  state.blocks.push({ index, raw, reason, startLine });
  state.reasons.add(reason);
}

/**
 * 把 segments 拼回"含占位 token"的 Markdown 文本（编辑器实际处理的版本）。
 */
export function joinSegmentsWithPlaceholders(segments: GuardedSegment[]): string {
  return segments
    .map((segment) => (segment.kind === 'protected' ? createProtectedBlockToken(segment.index) : segment.text))
    .join('\n\n');
}

/** 快速判断：这段文本是否"一眼就安全"，不需要走可视化模式。 */
export function isMarkdownSafe(body: string): boolean {
  return roundtripGuard(body).protectedBlocks.length === 0;
}
