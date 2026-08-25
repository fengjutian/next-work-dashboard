import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inlineMarkdownToWord, markdownToDocx, markdownToDocumentXml } from '../src/plugins/markdown-to-word/converter';

describe('markdown to Word converter', () => {
  it('escapes XML and converts inline formatting', () => {
    const xml = inlineMarkdownToWord('A & **bold** and `code`');
    expect(xml).toContain('A &amp; ');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('Consolas');
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
