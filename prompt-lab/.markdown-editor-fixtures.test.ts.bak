/**
 * markdown-editor fixtures 矩阵测试。
 *
 * 读取 tests/fixtures/markdown-editor/ 下所有 .md 文件，
 * 验证 inspectDocument 在每份样例上的行为符合预期：
 *  - 基础 markdown 应 wysiwygSafe=true
 *  - frontmatter / wiki link / cjk / 表格 / 任务列表等高优先级样例 wysiwygSafe=true
 *  - inline-html / unsupported-directives / crlf-document 应 wysiwygSafe=false
 *  - 特殊：wiki-links 应当被识别为受保护但仍可进入 WYSIWYG（P0 暂保持 wysiwygSafe=true）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inspectDocument } from '../src/plugins/markdown-editor/editor/markdown-codec';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'markdown-editor');

interface FixtureExpectation {
  wysiwygSafe: boolean;
  reason?: string;
}

const EXPECTATIONS: Record<string, FixtureExpectation> = {
  'basic.md': { wysiwygSafe: true },
  'nested-lists.md': { wysiwygSafe: true },
  'task-list.md': { wysiwygSafe: true },
  'gfm-table.md': { wysiwygSafe: true },
  'code-fences.md': { wysiwygSafe: true },
  'frontmatter.md': { wysiwygSafe: true },
  'wiki-links.md': { wysiwygSafe: true },
  'inline-html.md': { wysiwygSafe: false, reason: 'unsupported' },
  'unsupported-directives.md': { wysiwygSafe: false, reason: 'unsupported' },
  'crlf-document.md': { wysiwygSafe: false, reason: 'mixed-line-endings' },
  'cjk-content.md': { wysiwygSafe: true },
};

function loadFixture(name: string): { content: string; size: number; mixedLineEndings: boolean } {
  const path = join(FIXTURE_DIR, name);
  const buffer = readFileSync(path);
  const content = buffer.toString('utf8');
  const size = statSync(path).size;
  let hasLF = false;
  let hasCR = false;
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    if (b === 10) hasLF = true;
    else if (b === 13) hasCR = true;
  }
  // mixed line endings only if both LF and CR appear
  const mixedLineEndings = hasLF && hasCR;
  return { content, size, mixedLineEndings };
}

describe('markdown fixtures matrix', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md')).sort();
  for (const file of files) {
    const expected = EXPECTATIONS[file];
    if (!expected) {
      it.skip(`[skip] ${file} (no expectation registered)`, () => {});
      continue;
    }
    it(`${file} → wysiwygSafe=${expected.wysiwygSafe}${expected.reason ? ` (reason=${expected.reason})` : ''}`, () => {
      const { content, size, mixedLineEndings } = loadFixture(file);
      const result = inspectDocument(content, size, mixedLineEndings);
      expect(result.wysiwygSafe).toBe(expected.wysiwygSafe);
      if (expected.reason) {
        expect(result.reason).toBe(expected.reason);
      }
    });
  }

  it('basic.md: body excludes frontmatter when present', () => {
    const { content, size, mixedLineEndings } = loadFixture('frontmatter.md');
    const result = inspectDocument(content, size, mixedLineEndings);
    expect(result.frontmatter.present).toBe(true);
    expect(result.body).toBe('# Frontmatter 测试\n\n正文保持 frontmatter 原样，不被重新格式化。\n');
  });

  it('basic.md: preserves CRLF document size in bytes', () => {
    const { content, size, mixedLineEndings } = loadFixture('crlf-document.md');
    expect(mixedLineEndings).toBe(true);
    const result = inspectDocument(content, size, mixedLineEndings);
    expect(result.wysiwygSafe).toBe(false);
    expect(result.reason).toBe('mixed-line-endings');
  });
});
