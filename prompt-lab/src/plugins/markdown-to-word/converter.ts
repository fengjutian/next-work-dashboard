import JSZip from 'jszip';

export interface WordExportOptions {
  title?: string;
  author?: string;
}

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function run(text: string, properties = ''): string {
  const preserve = /^\s|\s$|\s{2}/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t${preserve}>${xmlEscape(text)}</w:t></w:r>`;
}

export function inlineMarkdownToWord(text: string): string {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const output: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push(run(text.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) output.push(run(token.slice(2, -2), '<w:b/>'));
    else if (token.startsWith('~~')) output.push(run(token.slice(2, -2), '<w:strike/>'));
    else if (token.startsWith('`')) output.push(run(token.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="EDEDED"/>'));
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      output.push(run(parts ? `${parts[1]} (${parts[2]})` : token, '<w:color w:val="0563C1"/><w:u w:val="single"/>'));
    } else output.push(run(token.slice(1, -1), '<w:i/>'));
    cursor = index + token.length;
  }
  if (cursor < text.length) output.push(run(text.slice(cursor)));
  return output.join('');
}

function paragraph(content: string, style?: string, extra = ''): string {
  const properties = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}`;
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;
}

function table(rows: string[][]): string {
  const cells = rows.map((row, rowIndex) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcBorders><w:top w:val="single" w:sz="4" w:color="B7B7B7"/><w:left w:val="single" w:sz="4" w:color="B7B7B7"/><w:bottom w:val="single" w:sz="4" w:color="B7B7B7"/><w:right w:val="single" w:sz="4" w:color="B7B7B7"/></w:tcBorders>${rowIndex === 0 ? '<w:shd w:fill="E7E6E6"/>' : ''}</w:tcPr>${paragraph(inlineMarkdownToWord(cell.trim()), undefined, rowIndex === 0 ? '<w:keepNext/>' : '')}</w:tc>`).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/></w:tblPr>${cells}</w:tbl>`;
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

export function markdownToDocumentXml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const body: string[] = [];
  let inCode = false;
  let code: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      if (inCode) {
        body.push(paragraph(run(code.join('\n'), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>'), undefined, '<w:shd w:fill="F2F2F2"/><w:spacing w:before="120" w:after="120"/>'));
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (line.includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const rows = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitTableRow(lines[index])); index += 1; }
      index -= 1;
      body.push(table(rows));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { body.push(paragraph(inlineMarkdownToWord(heading[2]), `Heading${heading[1].length}`)); continue; }
    const list = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      const level = Math.min(8, Math.floor(list[1].length / 2));
      const ordered = /^\d/.test(list[2]);
      body.push(paragraph(inlineMarkdownToWord(list[3]), undefined, `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr>`));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { body.push(paragraph(inlineMarkdownToWord(quote[1]), 'Quote')); continue; }
    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="808080"/></w:pBdr></w:pPr></w:p>'); continue; }
    body.push(paragraph(inlineMarkdownToWord(line)));
  }
  if (inCode && code.length) body.push(paragraph(run(code.join('\n'))));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

export async function markdownToDocx(markdown: string, options: WordExportOptions = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const now = new Date().toISOString();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.folder('word')?.file('document.xml', markdownToDocumentXml(markdown));
  zip.folder('word')?.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style>${[1,2,3,4,5,6].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${360 - level * 30}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${38 - level * 4}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:color="A6A6A6" w:space="8"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style></w:styles>`);
  const abstractNumbering = [1, 2].map((id) => `<w:abstractNum w:abstractNumId="${id}">${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${id === 1 ? 'bullet' : 'decimal'}"/><w:lvlText w:val="${id === 1 ? '•' : `%${level + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 + level * 360}"/></w:tabs><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`).join('');
  const numberingInstances = [1, 2].map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('');
  zip.folder('word')?.file('numbering.xml', `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstractNumbering}${numberingInstances}</w:numbering>`);
  zip.folder('word')?.folder('_rels')?.file('document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  zip.folder('docProps')?.file('core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title ?? '')}</dc:title><dc:creator>${xmlEscape(options.author ?? 'next-work-dashboard')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
