import { describe, expect, it } from 'vitest';
import { applyJsonPatch, canonicalizeJson, changesOnlyText, createJsonPatch, diffJsonTree, formatCsvForComparison, formatEnvForComparison, formatJsonForComparison, formatMarkdownForComparison, formatXmlForComparison, formatYamlForComparison, normalizeChineseLines, normalizeChineseText, normalizeParagraphs, parseCsv } from '../src/lib/comparison-modes';

describe('comparison modes', () => {
  it('segments mixed Chinese and English while normalizing width and punctuation', () => {
    const result = normalizeChineseText('你好，Ｗｏｒｌｄ！版本２。', { normalizeWidth: true, ignorePunctuation: true });
    expect(result).toContain('你好');
    expect(result).toContain('World');
    expect(result).toContain('2');
    expect(result).not.toMatch(/[，！。]/);
  });

  it('compares text by paragraphs', () => {
    expect(normalizeParagraphs('第一行\n 第二行\n\n\n第三段')).toBe('第一行 第二行\n\n第三段');
  });

  it('preserves Chinese line structure during the line-level comparison pass', () => {
    expect(normalizeChineseLines('你好，Ｗｏｒｌｄ！\n第二行。', { normalizeWidth: true, ignorePunctuation: true }))
      .toBe('你好World\n第二行');
  });

  it('sorts object keys and arrays by a selected key', () => {
    const value = { z: 1, items: [{ id: 10, name: 'b' }, { name: 'a', id: 2 }], a: 2 };
    expect(Object.keys(canonicalizeJson(value, 'id') as object)).toEqual(['a', 'items', 'z']);
    expect(formatJsonForComparison(JSON.stringify(value), { arrayKey: 'id' })).toContain('"id": 2');
  });

  it('produces tree changes, changed-only text, and JSON Patch operations', () => {
    const before = { name: 'old', removed: true, nested: { value: 1 } };
    const after = { name: 'new', added: true, nested: { value: 2 } };
    const changes = diffJsonTree(before, after);
    expect(changes.map((change) => [change.path, change.type])).toEqual([
      ['/added', 'add'], ['/name', 'replace'], ['/nested/value', 'replace'], ['/removed', 'remove'],
    ]);
    expect(changesOnlyText(changes, 'after')).toContain('/name: "new"');
    const patch = createJsonPatch(before, after);
    expect(patch).toContainEqual({ op: 'replace', path: '/name', value: 'new' });
    expect(applyJsonPatch(before, patch)).toEqual(after);
  });

  it('parses quoted CSV cells and renders a stable table', () => {
    expect(parseCsv('name,note\nAlice,"hello, world"\nBob,"line 1\nline 2"')).toEqual([
      ['name', 'note'], ['Alice', 'hello, world'], ['Bob', 'line 1\nline 2'],
    ]);
    expect(formatCsvForComparison('b,a\n2,1')).toContain('0002 │ 2 │ 1');
  });

  it('compares Markdown by semantic blocks', () => {
    const output = formatMarkdownForComparison('# Title\nfirst\nline\n\n- item\n```ts\nconst x = 1\n```');
    expect(output).toContain('H1 │ Title');
    expect(output).toContain('P │ first line');
    expect(output).toContain('LI │ item');
    expect(output).toContain('CODE ts │\n  const x = 1\nEND CODE │');
  });

  it('sorts env keys and redacts secrets by default', () => {
    expect(formatEnvForComparison('TOKEN=abc\nNAME=demo\nPORT=3000')).toBe('NAME=demo\nPORT=3000\nTOKEN=<redacted>');
    expect(formatEnvForComparison('TOKEN=abc', false)).toBe('TOKEN=abc');
  });

  it('canonicalizes YAML keys', () => {
    expect(formatYamlForComparison('z: 1\na:\n  b: 2')).toBe('a:\n  b: 2\nz: 1');
  });

  it('canonicalizes XML indentation and attribute order', () => {
    expect(formatXmlForComparison('<root z="1" a="2"><item> value </item></root>')).toBe('<root a="2" z="1">\n  <item>value</item>\n</root>');
  });
});
