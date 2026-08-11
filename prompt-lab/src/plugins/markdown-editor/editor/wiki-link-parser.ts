/**
 * Wiki Link 解析器 — 在 ProseMirror 文档树里查找 [[...]] 文本。
 *
 * 跟 core/knowledge/markdown.ts 里的 extractWikiLinks 不同：
 *  - 那个是字符串行级扫描
 *  - 这个是按 ProseMirror position 扫描，用于点击事件的位置反查
 */

import type { Node as PMNode } from '@tiptap/pm/model';

export interface WikiLinkMatch {
  /** 链接起点（包含 `[[`）。 */
  from: number;
  /** 链接终点（包含 `]]`）。 */
  to: number;
  /** 目标页名（`alias` 之前的部分）。 */
  target: string;
  /** 显示名（alias 或 target）。 */
  label: string;
}

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

export interface RegexMatch {
  index: number;
  length: number;
  target: string;
  label: string;
}

/** 在一段纯文本里扫描 Wiki Link，返回所有匹配（纯函数，可被测试 import）。 */
export function scanWikiLinksInText(text: string): RegexMatch[] {
  const out: RegexMatch[] = [];
  WIKI_LINK_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_PATTERN.exec(text)) !== null) {
    out.push({
      index: m.index,
      length: m[0].length,
      target: m[1].trim(),
      label: (m[2] ?? m[1]).trim(),
    });
    if (m[0].length === 0) WIKI_LINK_PATTERN.lastIndex += 1;
  }
  return out;
}

/**
 * 在 doc 中查找位置 pos 处的 Wiki Link。
 * 如果 pos 落在某个 [[...]] 内部（任意位置），返回该链接；否则返回 null。
 */
export function findWikiLinkAt(doc: PMNode, pos: number): WikiLinkMatch | null {
  let result: WikiLinkMatch | null = null;
  doc.descendants((node, nodePos) => {
    if (result) return false;
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === 'code')) return true;
    const text = node.text ?? '';
    for (const match of scanWikiLinksInText(text)) {
      const from = nodePos + match.index;
      const to = from + match.length;
      if (pos >= from && pos <= to) {
        result = { from, to, target: match.target, label: match.label };
        return false;
      }
    }
    return true;
  });
  return result;
}

/** 提取 doc 中所有 Wiki Link（用于索引、Backlink 等）。 */
export function findAllWikiLinks(doc: PMNode): WikiLinkMatch[] {
  const out: WikiLinkMatch[] = [];
  doc.descendants((node, nodePos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === 'code')) return true;
    const text = node.text ?? '';
    for (const match of scanWikiLinksInText(text)) {
      out.push({
        from: nodePos + match.index,
        to: nodePos + match.index + match.length,
        target: match.target,
        label: match.label,
      });
    }
    return true;
  });
  return out;
}
