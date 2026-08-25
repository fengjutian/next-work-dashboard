import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inlineMarkdownToWord, markdownToDocx, markdownToDocumentXml } from '../src/plugins/markdown-to-word/converter';

describe('markdown to Word converter', () => {
  it('escapes XML and converts inline formatting', () => {
    const xml = inlineMarkdownToWord('A & **bold**, `code`, https://example.com and ![chart](chart.png)');
    expect(xml).toContain('A &amp; ');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('Consolas');
    expect(xml).toContain('0563C1');
    expect(xml).toContain('图片：chart (chart.png)');
  });

  it('converts task lists and nested quotes', () => {
    const xml = markdownToDocumentXml('- [x] done\n- [ ] todo\n>> nested');
    expect(xml).toContain('☒ done');
    expect(xml).toContain('☐ todo');
    expect(xml).toContain('w:left="1440"');
  });

  it('converts extended document syntax', () => {
    const xml = markdownToDocumentXml('---\ntitle: Hidden\n---\n[TOC]\n\nTerm\n: Definition\n\n==mark== ^2^ ~n~\n\n```ts\nlet value = 1\n```\n\n[^1]: a note\n\n\\pagebreak');
    expect(xml).not.toContain('title: Hidden');
    expect(xml).toContain(' TOC \\o');
    expect(xml).toContain('Definition');
    expect(xml).toContain('w:highlight w:val="yellow"');
    expect(xml).toContain('w:val="superscript"');
    expect(xml).toContain('w:val="subscript"');
    expect(xml).toContain('TS</w:t>');
    expect(xml).toContain('a note');
    expect(xml).toContain('w:br w:type="page"');
  });

  it('converts headings, lists, quotes, code blocks and tables', () => {
    const xml = markdownToDocumentXml('# Title\n\n- item\n> quote\n```ts\nconst a = 1;\n```\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('const a = 1;');
    expect(xml).toContain('<w:tbl>');
  });

  it('creates a valid docx package with required parts', async () => {
    const buffer = await markdownToDocx('# Hello', { title: 'Test' });
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(await zip.file('docProps/core.xml')?.async('string')).toContain('<dc:title>Test</dc:title>');
  });
});
