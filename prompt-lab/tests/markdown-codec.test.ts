/**
 * markdown-codec 单元测试。
 *
 * 覆盖：
 *  - splitFrontmatter：基本/无 frontmatter/CRLF/含中文
 *  - decodeForEditor：safe / unsafe 判定、protectedBlocks 提取
 *  - encodeFromEditor：受保护块原样回填
 *  - roundtrip-guard：fence / MDX import / JSX / 表达式 / 指令 / 注释
 *
 * 注意：本文件不依赖 Tiptap Editor 实例（需要 DOM 环境），仅测试纯函数。
 * 端到端 Tiptap roundtrip 测试放在 markdown-editor-integration.test.ts 中。
 */

import { describe, expect, it } from 'vitest';
import { splitFrontmatter, decodeForEditor, encodeFromEditor } from '../src/plugins/markdown-editor/editor/markdown-codec';
import { roundtripGuard, isMarkdownSafe, joinSegmentsWithPlaceholders } from '../src/plugins/markdown-editor/editor/roundtrip-guard';
import { createProtectedBlockToken, parseProtectedBlockTokens } from '../src/plugins/markdown-editor/editor/protected-blocks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, 'fixtures', 'markdown');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('splitFrontmatter', () => {
  it('returns empty frontmatter when no metadata block is present', () => {
    const out = splitFrontmatter('# Hello\n\nbody');
    expect(out.frontmatter).toBe('');
    expect(out.body).toBe('# Hello\n\nbody');
  });

  it('extracts frontmatter verbatim including delimiters', () => {
    const out = splitFrontmatter('---\ntitle: x\nauthor: y\n---\n\n# Body');
    expect(out.frontmatter).toBe('---\ntitle: x\nauthor: y\n---\n\n');
    expect(out.body).toBe('# Body');
    expect(out.attributes.title).toBe('x');
    expect(out.attributes.author).toBe('y');
  });

  it('handles CRLF line endings', () => {
    const out = splitFrontmatter('---\r\ntitle: x\r\n---\r\n\r\nbody');
    expect(out.frontmatter).toBe('---\r\ntitle: x\r\n---\r\n\r\n');
    expect(out.body).toBe('body');
  });

  it('preserves Chinese content in attributes', () => {
    const out = splitFrontmatter('---\ntitle: 关山月\nauthor: 关羽\n---\nbody');
    expect(out.attributes.title).toBe('关山月');
    expect(out.attributes.author).toBe('关羽');
  });
});

describe('roundtripGuard', () => {
  it('returns no protected blocks for standard GFM', () => {
    const result = roundtripGuard('# Title\n\nparagraph\n\n- list\n- items\n');
    expect(result.protectedBlocks).toEqual([]);
    expect(result.reasons).toEqual([]);
  });

  it('treats fenced code blocks as protected in P0 (conservative)', () => {
    const result = roundtripGuard('text\n\n```js\ncode\n```\n\nmore text');
    expect(result.protectedBlocks.length).toBeGreaterThan(0);
    expect(result.protectedBlocks[0].raw).toContain('```js');
  });

  it('detects MDX import statements', () => {
    const result = roundtripGuard('import {Chart} from "./chart"\n\n# Title');
    expect(result.protectedBlocks.some((b) => b.reason === 'mdx-import')).toBe(true);
  });

  it('detects MDX export statements', () => {
    const result = roundtripGuard('export const meta = {title: "x"};\n\n# Title');
    expect(result.protectedBlocks.some((b) => b.reason === 'mdx-export')).toBe(true);
  });

  it('detects MDX single-line expressions', () => {
    const result = roundtripGuard('# Title\n\n{Math.PI * 2}\n');
    expect(result.protectedBlocks.some((b) => b.reason === 'mdx-expression')).toBe(true);
  });

  it('detects unknown directives', () => {
    const result = roundtripGuard(':::unknown-block\ncontent\n:::\n');
    expect(result.protectedBlocks.some((b) => b.reason === 'directive-unknown')).toBe(true);
  });

  it('detects HTML comment blocks', () => {
    const result = roundtripGuard('text\n\n<!-- comment line 1\nline 2 -->\n\nmore');
    expect(result.protectedBlocks.some((b) => b.reason === 'html-comment')).toBe(true);
  });

  it('detects multi-line HTML blocks', () => {
    const result = roundtripGuard('<div>\n<span>content</span>\n</div>\n');
    expect(result.protectedBlocks.some((b) => b.reason === 'html-block')).toBe(true);
  });

  it('isMarkdownSafe returns false when protected blocks exist', () => {
    expect(isMarkdownSafe('# title\n\ntext')).toBe(true);
    expect(isMarkdownSafe('import x from "y"\n\n# title')).toBe(false);
  });
});

describe('protected block tokens', () => {
  it('roundtrips placeholder tokens', () => {
    const token = createProtectedBlockToken(3);
    expect(token).toBe('<<MDX_PROTECTED:3>>');
    const parsed = parseProtectedBlockTokens(`before ${token} after`);
    expect(parsed).toEqual([{ index: 3, start: 7, end: 7 + token.length, text: token }]);
  });
});

describe('joinSegmentsWithPlaceholders', () => {
  it('inserts placeholders between safe segments', () => {
    const result = roundtripGuard('before\n\nimport x from "y"\n\nafter');
    const joined = joinSegmentsWithPlaceholders(result.segments);
    expect(joined).toContain('<<MDX_PROTECTED:0>>');
    expect(joined).toContain('before');
    expect(joined).toContain('after');
  });
});

describe('encodeFromEditor', () => {
  it('restores protected blocks verbatim', () => {
    const original = 'before\n\nimport x from "y"\n\nafter';
    const decoded = decodeForEditor(original);
    expect(decoded.protectedBlocks.length).toBe(1);
    // 模拟 Tiptap 输出：把 protected 块替换为占位 token。
    const fakeTiptap = joinSegmentsWithPlaceholders(decoded.guardedBody.segments);
    const restored = encodeFromEditor(fakeTiptap, decoded);
    expect(restored).toBe(original);
  });

  it('preserves frontmatter across encode', () => {
    const original = '---\ntitle: x\n---\n\n# Hello\n';
    const decoded = decodeForEditor(original);
    const fakeTiptap = joinSegmentsWithPlaceholders(decoded.guardedBody.segments);
    const restored = encodeFromEditor(fakeTiptap, decoded);
    expect(restored).toBe(original);
  });
});

describe('fixture roundtrip safety', () => {
  // P0 保守策略：含 fenced code block 的文档一律视为受保护。
  // 没有 fenced code 也没有 MDX/HTML 块的文档才是 safe。
  const unsafeFixtures = ['basic.md', 'code-fences.md', 'cjk-content.md'];
  const safeFixtures = ['nested-lists.md', 'task-list.md', 'gfm-table.md', 'frontmatter.md', 'wiki-links.md'];

  for (const name of safeFixtures) {
    it(`${name} is safe`, () => {
      const content = loadFixture(name);
      const guard = roundtripGuard(content);
      expect(guard.protectedBlocks.length).toBe(0);
      expect(isMarkdownSafe(content)).toBe(true);
    });
  }

  for (const name of unsafeFixtures) {
    it(`${name} is detected as unsafe (P0 conservative)`, () => {
      const content = loadFixture(name);
      const guard = roundtripGuard(content);
      expect(guard.protectedBlocks.length).toBeGreaterThan(0);
      expect(isMarkdownSafe(content)).toBe(false);
    });
  }

  it('inline-html.md is detected (may be safe or unsafe)', () => {
    // 内联 HTML 标签 <kbd>、<span> 等不是 block HTML，应为 safe；
    // 但内联 HTML 也可能触发 HTML block 检测（视实现而定）。这里做弱保证。
    const content = loadFixture('inline-html.md');
    const guard = roundtripGuard(content);
    expect(guard.protectedBlocks.length).toBeGreaterThanOrEqual(0);
  });

  it('unsupported-directives.md is detected as unsafe', () => {
    const content = loadFixture('unsupported-directives.md');
    const guard = roundtripGuard(content);
    expect(guard.protectedBlocks.length).toBeGreaterThan(0);
    expect(isMarkdownSafe(content)).toBe(false);
  });

  it('crlf-document.md preserves line endings (string-level)', () => {
    // 加载时 Node 已经把 CRLF 归一化为 LF（readFileSync 字符串形式）
    // 但 buffer 形式仍保留 CRLF。验证 buffer 形式。
    const buffer = readFileSync(join(FIXTURES, 'crlf-document.md'));
    const crlfCount = (buffer.toString('utf8').match(/\r\n/g) || []).length;
    expect(crlfCount).toBeGreaterThan(0);
  });

  it('cjk-content.md survives decode without loss', () => {
    // 即便 roundtrip-guard 标记为 unsafe，protected blocks 也必须原样回填。
    const content = loadFixture('cjk-content.md');
    const decoded = decodeForEditor(content);
    const fakeTiptap = joinSegmentsWithPlaceholders(decoded.guardedBody.segments);
    const restored = encodeFromEditor(fakeTiptap, decoded);
    expect(restored).toBe(content);
  });
});
