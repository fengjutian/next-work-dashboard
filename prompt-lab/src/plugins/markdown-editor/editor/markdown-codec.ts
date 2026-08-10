/**
 * markdown-codec — 业务代码与 Tiptap 之间的唯一边界。
 *
 * 责任：
 *  1. 在调用 Tiptap 之前，预先切分 frontmatter、检测不支持的语法。
 *  2. 在 Tiptap 序列化之后，重新拼接 frontmatter、补齐换行格式。
 *  3. 提供"安全 / 降级 / 拒绝"三档状态，便于 UI 与 roundtrip-guard 协作。
 *
 * 业务组件只允许：
 *   - import { detectSourceMode, prepareForEditor, composeFromEditor }
 *   - import type { CodecResult, CodecIssue }
 *
 * 不允许直接 import @tiptap/markdown。这样即使将来官方 API 变更，
 * 也只需要替换本文件，不必改动上层组件。
 */
import type { FrontmatterAttributes, SourceModeReason, MarkdownEncoding, LineEnding, RoundtripReport } from '../types';

// ── 公开 API ──

export interface CodecIssue {
  /** 行号（1-based），可选 */
  line?: number;
  /** 简短描述 */
  message: string;
  /** 该问题导致必须切源码模式 */
  forceSourceMode: boolean;
}

export interface CodecResult {
  /** 是否允许进入 WYSIWYG 模式 */
  wysiwygSafe: boolean;
  /** 如果不能进入，必须使用源码模式 */
  reason: SourceModeReason;
  /** 切分后的 frontmatter */
  frontmatter: FrontmatterAttributes;
  /** 给 Tiptap 的纯正文（不含 frontmatter） */
  body: string;
  /** 检测到的问题 */
  issues: CodecIssue[];
}

// ── 顶层检测 ──

/**
 * 不可逆或当前不支持的语法模式。命中任一即进入源码模式。
 * 行级正则而非全量解析，保证在百 MB 文档上不卡。
 */
const UNSUPPORTED_PATTERNS: Array<{ name: string; pattern: RegExp; force: boolean }> = [
  // MDX / JSX 标签（含 <Foo>、<foo.bar>）
  { name: 'jsx-tag', pattern: /(^|\n)\s*<[A-Z][\w.]*(?:\s[^>]*)?\/?>/, force: true },
  // MDX import / export
  { name: 'mdx-import', pattern: /(^|\n)\s*import\s+.+?from\s+['"][^'"]+['"]/, force: true },
  { name: 'mdx-export', pattern: /(^|\n)\s*export\s+(?:default|const|function|\{)/, force: true },
  // MDX 表达式 {expression}
  { name: 'mdx-expression', pattern: /(^|\n)\s*\{[A-Za-z_$][\w$.]*\s*[}\]]/, force: true },
  // 内联 JSX `<Foo />` 或 `<foo>` — 单独出现的也算
  { name: 'inline-jsx', pattern: /<[A-Za-z][\w-]*\s+[^<>]*\/>/, force: false },
  // Markdown 注释（很多方言支持，GFM 不支持）
  { name: 'markdown-comment', pattern: /<!--[\s\S]*?-->/, force: true },
  // 围栏属性指令 ```ts {1-3} 或 ``` {meta}
  { name: 'fenced-meta', pattern: /^```[a-zA-Z0-9_+\-]*\s+\{[^}]+\}/m, force: false },
  // Pandoc / Quarto 指令 ::: {.callout}
  { name: 'fenced-directive', pattern: /^:::\s*\{[^}]+\}/m, force: true },
];

/**
 * 已知但允许在 WYSIWYG 中保留的语法（受保护节点），
 * 不触发降级但需要在 roundtrip 中保持原样。
 */
const PROTECTED_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Wiki Link：[[Page]] / [[Page|Label]] / ![[Page]]
  { name: 'wiki-link', pattern: /!?\[\[[^\]\n]+\]\]/ },
  // 自定义指令 :::
  { name: 'fenced-directive', pattern: /^:::\s*\{[^}]+\}/m },
  // HTML 块（仅在行首出现才算 block-level）
  { name: 'html-block', pattern: /(^|\n)\s*<(?:div|section|aside|details|summary|figure|video|audio|iframe|table)\b/i },
];

/**
 * 解析 frontmatter — 复刻 src/core/knowledge/markdown.ts 的逻辑，
 * 但保留 raw 文本，方便无差异回填。
 */
export function splitFrontmatter(raw: string): FrontmatterAttributes {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return { raw: '', attributes: {}, bodyOffset: 0, present: false };
  }
  const attributes: Record<string, unknown> = {};
  let listField: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) {
      listField = field[2].trim() ? null : field[1];
      attributes[field[1]] = listField ? [] : scalar(field[2]);
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listField && listItem && Array.isArray(attributes[listField])) {
      (attributes[listField] as unknown[]).push(scalar(listItem[1]));
    } else if (line.trim()) {
      listField = null;
    }
  }
  return {
    raw: match[0],
    attributes,
    bodyOffset: match[0].length,
    present: true,
  };
}

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

/**
 * 重建 frontmatter：保留 raw 文本，不对属性做任何"再格式化"。
 * 如果 raw 为空（原本就没有 frontmatter），直接返回空字符串。
 */
export function joinFrontmatter(fm: FrontmatterAttributes): string {
  return fm.present ? fm.raw : '';
}

/**
 * 决定文档打开模式并切分 frontmatter。
 * 这是 markdown-codec 的入口之一。
 */
export function inspectDocument(
  content: string,
  size: number,
  mixedLineEndings: boolean,
): CodecResult {
  const issues: CodecIssue[] = [];
  let reason: SourceModeReason = null;
  let forceSource = false;

  // 1. 大小检查
  if (size > 5 * 1024 * 1024) {
    issues.push({ message: `文件超过 5 MB（${formatBytes(size)}），已切换到源码模式`, forceSourceMode: true });
    reason = 'too-large';
    forceSource = true;
  }

  // 2. 混合换行
  if (mixedLineEndings) {
    issues.push({ message: '文件中混用 LF/CRLF，源码模式可保留原状', forceSourceMode: true });
    if (!reason) reason = 'mixed-line-endings';
    forceSource = true;
  }

  // 3. 切分 frontmatter
  const fm = splitFrontmatter(content);
  const body = fm.present ? content.slice(fm.bodyOffset) : content;

  // 4. 不支持语法扫描（仅扫 body）
  for (const { name, pattern, force } of UNSUPPORTED_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      const line = countLines(body, match.index ?? 0) + (fm.present ? countLines(fm.raw, fm.raw.length) : 0);
      issues.push({
        line,
        message: `检测到 ${name}：${match[0].trim().slice(0, 80)}`,
        forceSourceMode: force,
      });
      if (force) {
        forceSource = true;
        if (!reason) reason = 'unsupported';
      }
    }
  }

  return {
    wysiwygSafe: !forceSource,
    reason,
    frontmatter: fm,
    body,
    issues,
  };
}

/**
 * 序列化 WYSIWYG 输出后，与原始文件拼接。
 * 保证：
 *  1. 换行符与原文件一致（LF/CRLF）。
 *  2. 末尾的换行行为与原文件一致（不强行补空行）。
 *  3. frontmatter 原样保留，不被重新格式化。
 */
export function composeDocument(
  frontmatter: FrontmatterAttributes,
  body: string,
  options: { lineEnding: LineEnding; trailingNewline: boolean },
): string {
  const normalizedBody = normalizeLineEndings(body, options.lineEnding);
  const fmText = frontmatter.present ? frontmatter.raw : '';
  // 检查原 frontmatter 末尾是否带换行，若带则确保与 body 之间也有换行
  const fmHasTrailingNewline = /\r?\n$/.test(fmText);
  let composed: string;
  if (fmText) {
    composed = fmHasTrailingNewline
      ? fmText + normalizedBody
      : fmText.replace(/(\r?\n)?$/, options.lineEnding === 'crlf' ? '\r\n' : '\n') + normalizedBody;
  } else {
    composed = normalizedBody;
  }
  if (options.trailingNewline && !/\r?\n$/.test(composed)) {
    composed += options.lineEnding === 'crlf' ? '\r\n' : '\n';
  }
  return composed;
}

/**
 * 检测原始内容末尾是否带换行（用于保存时回填）。
 */
export function hasTrailingNewline(content: string): boolean {
  return /\r?\n$/.test(content);
}

/**
 * 将任意换行统一为目标换行。
 * 若原文件混合换行（mixedLineEndings=true），原样保留 —
 * 该情况已被 inspectDocument 强制降级到源码模式。
 */
export function normalizeLineEndings(content: string, lineEnding: LineEnding): string {
  if (lineEnding === 'crlf') return content.replace(/\r\n|\r|\n/g, '\r\n');
  return content.replace(/\r\n|\r|\n/g, '\n');
}

/**
 * 计算给定字符偏移之前的换行数。
 * 用于把正则 match.index 转换为行号。
 */
function countLines(text: string, offset: number): number {
  let lines = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) lines += 1;
    else if (c === 13) {
      lines += 1;
      if (i + 1 < limit && text.charCodeAt(i + 1) === 10) i += 1;
    }
  }
  return lines;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── 弱类型版本的工具，避免循环依赖 ──

export function detectEncodingFromString(value: string): MarkdownEncoding {
  if (value.charCodeAt(0) === 0xfeff) return 'utf8bom';
  return 'utf8';
}

export function isUtf8Only(content: string): boolean {
  // 简化版：仅校验没有 NUL（U+0000），U+0080 之上对 UTF-8/GBK 都可能存在
  return !/\u0000/.test(content);
}
