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
    expect(xml).toContain('<w:t>const</w:t>');
    expect(xml).toContain('<w:t>a</w:t>');
    expect(xml).toContain('<w:tbl>');
  });

  it('creates a valid docx package with required parts', async () => {
    const buffer = await markdownToDocx('# Hello', { title: 'Test' });
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(await zip.file('docProps/core.xml')?.async('string')).toContain('<dc:title>Test</dc:title>');
  });

  it('creates advanced Word parts and external relationships', async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 100, 0, 0, 0, 50]);
    const buffer = await markdownToDocx('# Report\n\n[OpenAI](https://openai.com)\n\n![Chart](chart.png)\n\nA fact[^1].\n\n[^1]: Source', {
      title: 'Report', author: 'Author', header: 'Header', footer: 'Footer', pageNumbers: true, cover: true,
      chapterNumbering: true, tableZebra: true, resolveImage: async () => ({ data: png.buffer, mimeType: 'image/png' }),
    });
    const zip = await JSZip.loadAsync(buffer);
    const document = await zip.file('word/document.xml')?.async('string');
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string');
    expect(document).toContain('<w:drawing>');
    expect(document).toContain('<w:hyperlink r:id=');
    expect(document).toContain('<w:footnoteReference');
    expect(rels).toContain('relationships/hyperlink');
    expect(rels).toContain('relationships/image');
    expect(zip.file('word/media/image1.png')).not.toBeNull();
    expect(zip.file('word/header1.xml')).not.toBeNull();
    expect(zip.file('word/footer1.xml')).not.toBeNull();
    expect(zip.file('word/footnotes.xml')).not.toBeNull();
    expect(await zip.file('word/settings.xml')?.async('string')).toContain('updateFields');
  });

  it('converts formulas, alerts and common HTML', () => {
    const xml = markdownToDocumentXml('$$ E = mc^2 $$\n> [!WARNING] Be careful\n<table><tr><th>A</th></tr><tr><td>B</td></tr></table>\n<u>underlined</u>');
    expect(xml).toContain('<m:oMathPara');
    expect(xml).toContain('ED7D31');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:u w:val="single"/>');
  });

  it('supports image attributes, table captions and citations', async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 100, 0, 0, 0, 50]);
    const buffer = await markdownToDocx('![Chart](chart.png){width=50% align=right caption="Sales"}\n\nTable: Results\n| A | B |\n|:---|---:|\n|1|2|\n\nSee [@doe].\n\n[@doe]: Doe, 2026.', { resolveImage: async () => ({ data: png.buffer, mimeType: 'image/png' }) });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('w:val="right"');
    expect(xml).toContain('图 1  Sales');
    expect(xml).toContain('表 1  Results');
    expect(xml).toContain('w:anchor="ref_doe"');
    expect(xml).toContain('Doe, 2026.');
  });
});
