/**
 * markdown-codec — 业务层与 Tiptap Markdown 之间的唯一桥梁。
 *
 * 责任：
 *  1. 在进入 Tiptap 之前，把 Markdown 文本切成 (frontmatter, body) 两段。
 *  2. 检测 body 里的不支持语法（MDX/JSX/未注册指令/嵌入表达式），把它们替换为
 *     「受保护占位 token」，并把原始片段保存在我们的结构里。
 *  3. 调用 Tiptap @tiptap/markdown 把安全部分解析为 Tiptap JSON。
 *  4. 导出时，把受保护占位还原回原始 Markdown。
 *  5. 在 roundtrip-guard 的检查中，把"未编辑"文档视作已经完成。
 *
 * 这是 Beta API 唯一被引用的文件。后续若 Tiptap Markdown 升级或切到 unified/remark
 * 转换链，只需替换此文件，其他业务代码不受影响。
 */

import { parseFrontmatter as parseKnowledgeFrontmatter } from '@/core/knowledge/markdown';
import { joinSegmentsWithPlaceholders, roundtripGuard, type GuardedMarkdown } from './roundtrip-guard';
import { createProtectedBlockToken, parseProtectedBlockTokens, type ProtectedBlock } from './protected-blocks';

/**
 * 一个 Markdown 文档经过预处理后的中间表示。包含 frontmatter、安全正文和受保护片段。
 * Tiptap 只看到 body；frontmatter 和 protectedBlocks 在保存前会重新拼回。
 */
export interface DecodedMarkdown {
  /** 原始 frontmatter 文本（含 `---` 边界和换行符）。无 frontmatter 时为空字符串。 */
  frontmatter: string;
  /** 解析后的 frontmatter 属性（仅供 UI 展示，不参与序列化）。 */
  frontmatterAttributes: Record<string, unknown>;
  /** 已被 Tiptap 处理的 Markdown 主体。 */
  body: string;
  /** 检测到的受保护片段（MDX/JSX/未知指令等），保存前会原样回填。 */
  protectedBlocks: ProtectedBlock[];
  /** 受保护片段已被替换为占位 token 的 Markdown（也就是真正交给 Tiptap 的文本）。 */
  guardedBody: GuardedMarkdown;
}

const LF = '\n';

/** 把带前导空白的字符串规范化为带尾部换行符的形式（如果有内容的话）。 */
function ensureTrailingNewline(text: string): string {
  if (!text) return text;
  return text.endsWith('\n') ? text : text + LF;
}

/**
 * 拆分 frontmatter 与 body。
 * 复用 `@/core/knowledge/markdown` 的 parseFrontmatter（已经处理过 YAML）。
 * 注意：parseFrontmatter 返回的 body 不会包含 frontmatter 块。
 */
export function splitFrontmatter(rawContent: string): { frontmatter: string; body: string; attributes: Record<string, unknown> } {
  const trimmedStart = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
  const match = trimmedStart.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: '', body: trimmedStart, attributes: {} };
  }
  // 用 knowledge 的解析器拿到结构化的 attributes（仅用于 UI）。
  const { attributes } = parseKnowledgeFrontmatter(trimmedStart);
  return {
    frontmatter: match[0],
    body: trimmedStart.slice(match[0].length),
    attributes,
  };
}

/**
 * 准备 Markdown 内容以供 Tiptap 处理：拆分 frontmatter、用占位 token 替换受保护块。
 * 这是 `parse` 流程的第一步。
 */
export function decodeForEditor(rawContent: string): DecodedMarkdown {
  const { frontmatter, body, attributes } = splitFrontmatter(rawContent);
  const guarded = roundtripGuard(body);
  // 占位 token 之间需要空行，避免被 Tiptap 合并到相邻节点。
  const guardedBodyText = guarded.segments
    .map((segment) => (segment.kind === 'protected' ? createProtectedBlockToken(segment.index) : segment.text))
    .join('\n\n');
  return {
    frontmatter,
    frontmatterAttributes: attributes,
    body,
    protectedBlocks: guarded.protectedBlocks,
    guardedBody: guarded,
    // guardedBodyText 仅用于调试和单元测试；编辑器主流程直接用 guarded.segments。
    ...{ guardedBodyText },
  } as DecodedMarkdown & { guardedBodyText: string };
}

/** 把 frontmatter 重新拼到 body 之前。 */
export function composeWithFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return frontmatter + ensureTrailingNewline(body);
}

/**
 * 将 Tiptap 输出的 Markdown 重新拼装：body + 受保护块原样回填 + frontmatter。
 *
 * @param tiptapMarkdown Tiptap editor.getMarkdown() 的输出
 * @param decoded 之前 decodeForEditor 的结果，用于拿到 protectedBlocks 和 frontmatter
 * @returns 完整的、可写盘的 Markdown 文本
 */
export function encodeFromEditor(tiptapMarkdown: string, decoded: DecodedMarkdown): string {
  // 1. 把 Tiptap Markdown 中残留的占位 token 还原为受保护块原文。
  const restored = restoreProtectedBlocks(tiptapMarkdown, decoded.protectedBlocks);
  // 2. 拼回 frontmatter。
  return composeWithFrontmatter(decoded.frontmatter, restored);
}

/** 用 protectedBlocks 还原 Tiptap Markdown 中的占位 token。 */
function restoreProtectedBlocks(markdown: string, blocks: ProtectedBlock[]): string {
  if (blocks.length === 0) return markdown;
  const tokens = parseProtectedBlockTokens(markdown);
  if (tokens.length === 0) {
    // Tiptap 可能完全丢弃了占位 token（不常见），此时把原始 body 视为 fallback。
    return blocks.map((b) => b.raw).join('\n\n');
  }
  const sortedTokens = [...tokens].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let result = '';
  for (const token of sortedTokens) {
    result += markdown.slice(cursor, token.start);
    const block = blocks.find((candidate) => candidate.index === token.index);
    if (block) {
      result += block.raw;
    } else {
      // 占位 token 找不到对应 block（不该发生），保留 token 自身。
      result += markdown.slice(token.start, token.end);
    }
    cursor = token.end;
  }
  result += markdown.slice(cursor);
  return result;
}

/** 占位 token 的工厂与解析（re-export 给编辑器/测试）。 */
export {
  PROTECTED_BLOCK_PLACEHOLDER_PREFIX,
  PROTECTED_BLOCK_PLACEHOLDER_SUFFIX,
  createProtectedBlockToken,
  parseProtectedBlockTokens,
} from './protected-blocks';
export type { ProtectedBlock, ProtectedBlockToken } from './protected-blocks';

/** 把 segments 拼回"含占位 token"的 Markdown 文本（re-export）。 */
export { joinSegmentsWithPlaceholders } from './roundtrip-guard';
