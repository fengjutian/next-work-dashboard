/**
 * 受保护块（protected blocks）的定义与占位 token 协议。
 *
 * 业务场景：用户文档中含 MDX/JSX/未注册指令/HTML 块等我们不能保证安全往返的语法。
 * roundtrip-guard 会把这些片段提取为 ProtectedBlock，并在 Tiptap 处理过的文本里
 * 替换为「占位 token」。保存时再把 token 还原为原始文本，从而做到字符级无损。
 *
 * 占位 token 格式：`<<MDX_PROTECTED:0>>` —— 用双书名号包裹，数字是块在文档里的顺序。
 * 选择 `<<...>>` 是因为它既不是合法 Markdown 字符，也不会出现在 fenced code 里。
 * Tiptap 看到它会当作普通文本节点留到导出时还原。
 */

export const PROTECTED_BLOCK_PLACEHOLDER_PREFIX = '<<MDX_PROTECTED:';
export const PROTECTED_BLOCK_PLACEHOLDER_SUFFIX = '>>';

/** 受保护片段。 */
export interface ProtectedBlock {
  /** 块在文档中的顺序（0-based）。占位 token 里的数字与之对应。 */
  index: number;
  /** 原始文本（含前后换行，匹配 markdown 中的真实形态）。 */
  raw: string;
  /** 触发受保护的原因标签。 */
  reason: ProtectedBlockReason;
  /** 块起始行号（1-based），便于诊断信息展示。 */
  startLine: number;
}

/** 触发受保护的原因。 */
export type ProtectedBlockReason =
  | 'mdx-import' // `import X from 'y'`
  | 'mdx-export' // `export const x = ...`
  | 'mdx-jsx' // `<Component />` 或 `<Component>...</Component>`
  | 'mdx-expression' // `{expression}`
  | 'directive-unknown' // 未知指令，如 `:::unknown`
  | 'html-block' // 整段 HTML block（GitHub 风格整段 <div>...</div>）
  | 'reference-link-unknown' // 引用式链接但 reference 未定义
  | 'escape-sequence' // 反斜杠转义
  | 'html-comment'; // `<!-- ... -->`

/** 占位 token 的解析结果。 */
export interface ProtectedBlockToken {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** 构造一个占位 token。 */
export function createProtectedBlockToken(index: number): string {
  return `${PROTECTED_BLOCK_PLACEHOLDER_PREFIX}${index}${PROTECTED_BLOCK_PLACEHOLDER_SUFFIX}`;
}

/** 在文本中查找所有占位 token。 */
export function parseProtectedBlockTokens(text: string): ProtectedBlockToken[] {
  const tokens: ProtectedBlockToken[] = [];
  const pattern = new RegExp(`${escapeRegex(PROTECTED_BLOCK_PLACEHOLDER_PREFIX)}(\\d+)${escapeRegex(PROTECTED_BLOCK_PLACEHOLDER_SUFFIX)}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      index: Number(match[1]),
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }
  return tokens;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
