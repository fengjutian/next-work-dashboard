/**
 * markdown-codec 单元测试。
 *
 * 覆盖：
 *  1. frontmatter 切分（存在 / 不存在 / 含 list / 含引号）
 *  2. 不支持语法检测（MDX / JSX / 指令 / 注释）
 *  3. composeDocument 在 LF/CRLF 下的换行处理
 *  4. normalizeLineEndings / hasTrailingNewline 工具
 *  5. 大小阈值触发源码模式
 *  6. 混合换行触发源码模式
 */
import { describe, expect, it } from 'vitest';
import {
  composeDocument,
  hasTrailingNewline,
  inspectDocument,
  normalizeLineEndings,
  splitFrontmatter,
} from '../src/plugins/markdown-editor/editor/markdown-codec';
import type { FrontmatterAttributes } from '../src/plugins/markdown-editor/types';

const SIMPLE_FM: FrontmatterAttributes = {
  raw: '---\ntitle: Hello\n---\n',
  attributes: { title: 'Hello' },
  bodyOffset: 19,
  present: true,
};

describe('splitFrontmatter', () => {
  it('parses simple frontmatter with scalar value', () => {
    const { attributes, body, bodyOffset, present } = splitFrontmatter('---\ntitle: Hi\n---\n# Body');
    expect(present).toBe(true);
    expect(attributes).toEqual({ title: 'Hi' });
    expect(body).toBe('# Body');
    expect(bodyOffset).toBe(16);
  });

  it('handles list values', () => {
    const { attributes } = splitFrontmatter('---\ntags:\n  - a\n  - b\n---\nbody');
    expect(attributes).toEqual({ tags: ['a', 'b'] });
  });

  it('handles quoted strings', () => {
    const { attributes } = splitFrontmatter('---\ntitle: "Quoted title"\n---\nbody');
    expect(attributes).toEqual({ title: 'Quoted title' });
  });

  it('returns empty attributes when no frontmatter is present', () => {
    const { attributes, body, present } = splitFrontmatter('# Body\ntext');
    expect(present).toBe(false);
    expect(attributes).toEqual({});
    expect(body).toBe('# Body\ntext');
  });

  it('handles CR-LF line endings in frontmatter', () => {
    const { attributes, body, present } = splitFrontmatter('---\r\ntitle: X\r\n---\r\nbody');
    expect(present).toBe(true);
    expect(attributes).toEqual({ title: 'X' });
    expect(body).toBe('body');
  });
});

describe('inspectDocument', () => {
  it('returns wysiwygSafe for plain Markdown', () => {
    const result = inspectDocument('# Title\n\nText', 50, false);
    expect(result.wysiwygSafe).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.body).toBe('# Title\n\nText');
  });

  it('detects MDX import and forces source mode', () => {
    const content = '# Title\n\nimport x from "y";\n\ntext';
    const result = inspectDocument(content, content.length, false);
    expect(result.wysiwygSafe).toBe(false);
    expect(result.reason).toBe('unsupported');
    expect(result.issues.some((i) => i.message.includes('mdx-import'))).toBe(true);
  });

  it('detects JSX components', () => {
    const content = '# Title\n\n<Foo bar="baz" />';
    const result = inspectDocument(content, content.length, false);
    expect(result.wysiwygSafe).toBe(false);
  });

  it('detects fenced directive', () => {
    const content = '::: {.callout}\ntext\n:::';
    const result = inspectDocument(content, content.length, false);
    expect(result.wysiwygSafe).toBe(false);
  });

  it('flags large file as too-large', () => {
    const big = 'a'.repeat(5 * 1024 * 1024 + 10);
    const result = inspectDocument(big, big.length, false);
    expect(result.wysiwygSafe).toBe(false);
    expect(result.reason).toBe('too-large');
  });

  it('flags mixed line endings', () => {
    const content = '# Title\r\nline1\nline2';
    const result = inspectDocument(content, content.length, true);
    expect(result.wysiwygSafe).toBe(false);
    expect(result.reason).toBe('mixed-line-endings');
  });

  it('separates frontmatter from body', () => {
    const content = '---\ntitle: X\n---\n# Body';
    const result = inspectDocument(content, content.length, false);
    expect(result.frontmatter.present).toBe(true);
    expect(result.body).toBe('# Body');
  });
});

describe('normalizeLineEndings / hasTrailingNewline', () => {
  it('normalizes mixed endings to LF', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd', 'lf')).toBe('a\nb\nc\nd');
  });

  it('normalizes to CRLF', () => {
    expect(normalizeLineEndings('a\nb\r\nc', 'crlf')).toBe('a\r\nb\r\nc');
  });

  it('detects trailing newline', () => {
    expect(hasTrailingNewline('a\n')).toBe(true);
    expect(hasTrailingNewline('a\r\n')).toBe(true);
    expect(hasTrailingNewline('a')).toBe(false);
  });
});

describe('composeDocument', () => {
  it('preserves frontmatter and normalizes body line endings to LF', () => {
    const out = composeDocument(SIMPLE_FM, 'body\n', { lineEnding: 'lf', trailingNewline: true });
    expect(out.startsWith('---\ntitle: Hello\n---\n')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('converts body to CRLF when requested', () => {
    const out = composeDocument(SIMPLE_FM, 'line1\nline2', { lineEnding: 'crlf', trailingNewline: false });
    expect(out).toContain('line1\r\nline2');
  });

  it('keeps document with no frontmatter unchanged in shape', () => {
    const fm: FrontmatterAttributes = { raw: '', attributes: {}, bodyOffset: 0, present: false };
    const out = composeDocument(fm, 'only body', { lineEnding: 'lf', trailingNewline: true });
    expect(out).toBe('only body\n');
  });

  it('adds trailing newline when requested but body lacks one', () => {
    const fm: FrontmatterAttributes = { raw: '', attributes: {}, bodyOffset: 0, present: false };
    const out = composeDocument(fm, 'no newline', { lineEnding: 'lf', trailingNewline: true });
    expect(out.endsWith('\n')).toBe(true);
  });
});
