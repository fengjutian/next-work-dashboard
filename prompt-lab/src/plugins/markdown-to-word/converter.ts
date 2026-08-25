import JSZip from 'jszip';

export interface WordExportOptions {
  title?: string;
  author?: string;
  subject?: string;
  fontFamily?: string;
  fontSize?: number;
  lineSpacing?: number;
  marginCm?: number;
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
  cover?: boolean;
  date?: string;
  chapterNumbering?: boolean;
  tableZebra?: boolean;
  sourcePath?: string;
  resolveImage?: (source: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
}

interface RenderContext {
  relationship?: (target: string, type: 'hyperlink' | 'image') => string;
  images?: Map<string, { id: string; name: string; width: number; height: number }>;
  options?: WordExportOptions;
}

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function run(text: string, properties = ''): string {
  const preserve = /^\s|\s$|\s{2}/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t${preserve}>${xmlEscape(text)}</w:t></w:r>`;
}

export function inlineMarkdownToWord(text: string, context: RenderContext = {}): string {
  const pattern = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|==[^=]+==|`[^`]+`|\^[^^]+\^|~[^~]+~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|\[\^[^\]]+\]|https?:\/\/[^\s<]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\\[\\`*_[\]~^=])/g;
  const output: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push(run(text.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith('\\')) output.push(run(token.slice(1)));
    else if (token.startsWith('![')) {
      const parts = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      const image = parts ? context.images?.get(parts[2]) : undefined;
      if (parts && image) {
        const width = Math.min(5486400, image.width * 9525);
        const height = Math.round(width * image.height / image.width);
        output.push(`<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${image.id.replace(/\D/g, '') || '1'}" name="${xmlEscape(parts[1] || image.name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${xmlEscape(image.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`);
      } else output.push(run(parts ? `图片：${parts[1] || '未命名图片'} (${parts[2]})` : token, '<w:i/><w:color w:val="666666"/>'));
    } else if (token.startsWith('**') || token.startsWith('__')) output.push(run(token.slice(2, -2), '<w:b/>'));
    else if (token.startsWith('~~')) output.push(run(token.slice(2, -2), '<w:strike/>'));
    else if (token.startsWith('==')) output.push(run(token.slice(2, -2), '<w:highlight w:val="yellow"/>'));
    else if (token.startsWith('`')) output.push(run(token.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="EDEDED"/>'));
    else if (token.startsWith('^')) output.push(run(token.slice(1, -1), '<w:vertAlign w:val="superscript"/>'));
    else if (token.startsWith('~')) output.push(run(token.slice(1, -1), '<w:vertAlign w:val="subscript"/>'));
    else if (token.startsWith('[^')) output.push(run(token.slice(2, -1), '<w:vertAlign w:val="superscript"/><w:color w:val="0563C1"/>'));
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parts && context.relationship) {
        const id = context.relationship(parts[2], 'hyperlink');
        output.push(`<w:hyperlink r:id="${id}" w:history="1">${run(parts[1], '<w:color w:val="0563C1"/><w:u w:val="single"/>')}</w:hyperlink>`);
      } else output.push(run(parts ? `${parts[1]} (${parts[2]})` : token, '<w:color w:val="0563C1"/><w:u w:val="single"/>'));
    } else if (/^https?:\/\//.test(token) || token.includes('@')) {
      const target = token.includes('@') && !/^https?:/.test(token) ? `mailto:${token}` : token;
      const id = context.relationship?.(target, 'hyperlink');
      output.push(id ? `<w:hyperlink r:id="${id}" w:history="1">${run(token, '<w:color w:val="0563C1"/><w:u w:val="single"/>')}</w:hyperlink>` : run(token, '<w:color w:val="0563C1"/><w:u w:val="single"/>'));
    }
    else output.push(run(token.slice(1, -1), '<w:i/>'));
    cursor = index + token.length;
  }
  if (cursor < text.length) output.push(run(text.slice(cursor)));
  return output.join('');
}

function paragraph(content: string, style?: string, extra = ''): string {
  const properties = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}`;
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;
}

function table(rows: string[][], alignments: string[], context: RenderContext): string {
  const cells = rows.map((row, rowIndex) => `<w:tr>${row.map((cell, columnIndex) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / Math.max(1, row.length))}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:color="B7B7B7"/><w:left w:val="single" w:sz="4" w:color="B7B7B7"/><w:bottom w:val="single" w:sz="4" w:color="B7B7B7"/><w:right w:val="single" w:sz="4" w:color="B7B7B7"/></w:tcBorders>${rowIndex === 0 ? '<w:shd w:fill="E7E6E6"/>' : context.options?.tableZebra && rowIndex % 2 === 0 ? '<w:shd w:fill="F7F7F7"/>' : ''}</w:tcPr>${paragraph(inlineMarkdownToWord(cell.trim(), context), undefined, `${rowIndex === 0 ? '<w:keepNext/>' : ''}<w:jc w:val="${alignments[columnIndex] || 'left'}"/>`)}</w:tc>`).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/></w:tblPr>${cells}</w:tbl>`;
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function imageDimensions(data: Uint8Array, mimeType: string): { width: number; height: number } {
  if (mimeType.includes('png') && data.length >= 24) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      const length = (data[offset + 2] << 8) + data[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (data[offset + 5] << 8) + data[offset + 6], width: (data[offset + 7] << 8) + data[offset + 8] };
      offset += 2 + length;
    }
  }
  return { width: 640, height: 360 };
}

export function markdownToDocumentXml(markdown: string, context: RenderContext = {}): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const body: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let codeLanguage = '';
  const footnotes: Array<{ id: string; content: string }> = [];
  const headingCounters = [0, 0, 0, 0, 0, 0];
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (end >= 0) lines.splice(0, end + 2);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^```\s*([^\s`]*)/.exec(line.trim());
    if (fence) {
      if (inCode) {
        if (codeLanguage) body.push(paragraph(run(codeLanguage.toUpperCase(), '<w:b/><w:color w:val="666666"/><w:sz w:val="16"/>'), undefined, '<w:shd w:fill="E7E6E6"/><w:spacing w:before="120"/>'));
        body.push(paragraph(run(code.join('\n'), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>'), undefined, '<w:shd w:fill="F2F2F2"/><w:spacing w:before="120" w:after="120"/>'));
        code = [];
        codeLanguage = '';
      } else {
        codeLanguage = fence[1] || '';
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const footnote = /^\[\^([^\]]+)\]:\s*(.+)$/.exec(line);
    if (footnote) { footnotes.push({ id: footnote[1], content: footnote[2] }); continue; }
    if (/^\s*\[TOC\]\s*$/i.test(line)) {
      body.push('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>在 Word 中更新域以生成目录</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
      continue;
    }
    if (/^\s*<!--\s*pagebreak\s*-->\s*$/i.test(line) || /^\s*\\pagebreak\s*$/.test(line)) {
      body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      continue;
    }
    if (index + 1 < lines.length && /^:\s+/.test(lines[index + 1])) {
      body.push(paragraph(inlineMarkdownToWord(line, context), undefined, '<w:keepNext/><w:spacing w:after="0"/>'));
      index += 1;
      body.push(paragraph(inlineMarkdownToWord(lines[index].replace(/^:\s+/, ''), context), undefined, '<w:ind w:left="720"/><w:spacing w:before="0"/>'));
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const rows = [splitTableRow(line)];
      const alignments = splitTableRow(lines[index + 1]).map((value) => value.trim().startsWith(':') && value.trim().endsWith(':') ? 'center' : value.trim().endsWith(':') ? 'right' : 'left');
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitTableRow(lines[index])); index += 1; }
      index -= 1;
      body.push(table(rows, alignments, context));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      headingCounters[level - 1] += 1;
      headingCounters.fill(0, level);
      const prefix = context.options?.chapterNumbering ? `${headingCounters.slice(0, level).filter(Boolean).join('.')} ` : '';
      body.push(paragraph(inlineMarkdownToWord(`${prefix}${heading[2]}`, context), `Heading${level}`));
      continue;
    }
    const list = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      const level = Math.min(8, Math.floor(list[1].length / 2));
      const ordered = /^\d/.test(list[2]);
      const task = /^\[([ xX])\]\s+(.+)$/.exec(list[3]);
      const content = task ? `${task[1].toLowerCase() === 'x' ? '☒' : '☐'} ${task[2]}` : list[3];
      body.push(paragraph(inlineMarkdownToWord(content, context), undefined, `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr>`));
      continue;
    }
    const quote = /^(>+)\s?(.*)$/.exec(line);
    if (quote) { body.push(paragraph(inlineMarkdownToWord(quote[2], context), 'Quote', `<w:ind w:left="${Math.min(2880, quote[1].length * 720)}"/>`)); continue; }
    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="808080"/></w:pBdr></w:pPr></w:p>'); continue; }
    body.push(paragraph(inlineMarkdownToWord(line, context)));
  }
  if (inCode && code.length) body.push(paragraph(run(code.join('\n'))));
  if (footnotes.length) {
    body.push(paragraph(run('脚注', '<w:b/>'), 'Heading2'));
    footnotes.forEach((note) => body.push(paragraph(`${run(note.id, '<w:vertAlign w:val="superscript"/>')}${run(`  ${note.content}`)}`, undefined, '<w:spacing w:after="80"/>')));
  }
  const margin = Math.round((context.options?.marginCm ?? 2.54) * 567);
  const headerRefs = `${context.options?.header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ''}${context.options?.footer || context.options?.pageNumbers ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : ''}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr>${headerRefs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}"/></w:sectPr></w:body></w:document>`;
}

export async function markdownToDocx(markdown: string, options: WordExportOptions = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const now = new Date().toISOString();
  const relationships: string[] = [];
  let relationshipIndex = 10;
  const relationship = (target: string, type: 'hyperlink' | 'image') => {
    const id = `rId${relationshipIndex++}`;
    relationships.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xmlEscape(target)}"${type === 'hyperlink' ? ' TargetMode="External"' : ''}/>`);
    return id;
  };
  const images = new Map<string, { id: string; name: string; width: number; height: number }>();
  const imageSources = Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g), (match) => match[1]);
  if (options.resolveImage) {
    for (const source of new Set(imageSources)) {
      const resolved = await options.resolveImage(source).catch(() => null);
      if (!resolved) continue;
      const bytes = new Uint8Array(resolved.data);
      const extension = resolved.mimeType.includes('png') ? 'png' : resolved.mimeType.includes('gif') ? 'gif' : 'jpg';
      const name = `image${images.size + 1}.${extension}`;
      zip.folder('word')?.folder('media')?.file(name, bytes);
      const id = relationship(`media/${name}`, 'image');
      images.set(source, { id, name, ...imageDimensions(bytes, resolved.mimeType) });
    }
  }
  const optionalTypes = `${options.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${options.footer || options.pageNumbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${optionalTypes}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  let documentXml = markdownToDocumentXml(markdown, { relationship, images, options });
  if (options.cover) {
    const cover = `${paragraph(run(options.title || '未命名文档', '<w:b/><w:sz w:val="52"/>'), undefined, '<w:jc w:val="center"/><w:spacing w:before="2800" w:after="500"/>')}${paragraph(run(options.author || '', '<w:sz w:val="26"/>'), undefined, '<w:jc w:val="center"/>')}${paragraph(run(options.date || new Date().toLocaleDateString(), '<w:sz w:val="22"/>'), undefined, '<w:jc w:val="center"/><w:spacing w:before="300"/>')}<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    documentXml = documentXml.replace('<w:body>', `<w:body>${cover}`);
  }
  zip.folder('word')?.file('document.xml', documentXml);
  const font = xmlEscape(options.fontFamily || 'Microsoft YaHei');
  const fontSize = Math.round((options.fontSize || 11) * 2);
  const line = Math.round((options.lineSpacing || 1.5) * 240);
  zip.folder('word')?.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="${line}" w:lineRule="auto" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:sz w:val="${fontSize}"/></w:rPr></w:style>${[1,2,3,4,5,6].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${360 - level * 30}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${38 - level * 4}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:color="A6A6A6" w:space="8"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style></w:styles>`);
  const abstractNumbering = [1, 2].map((id) => `<w:abstractNum w:abstractNumId="${id}">${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${id === 1 ? 'bullet' : 'decimal'}"/><w:lvlText w:val="${id === 1 ? '•' : `%${level + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 + level * 360}"/></w:tabs><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`).join('');
  const numberingInstances = [1, 2].map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('');
  zip.folder('word')?.file('numbering.xml', `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstractNumbering}${numberingInstances}</w:numbering>`);
  const headerRel = options.header ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : '';
  const footerRel = options.footer || options.pageNumbers ? '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '';
  zip.folder('word')?.folder('_rels')?.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${headerRel}${footerRel}${relationships.join('')}</Relationships>`);
  zip.folder('word')?.file('settings.xml', '<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>');
  if (options.header) zip.folder('word')?.file('header1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(run(options.header), undefined, '<w:jc w:val="center"/>')}</w:hdr>`);
  if (options.footer || options.pageNumbers) zip.folder('word')?.file('footer1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${options.footer ? run(`${options.footer}  `) : ''}${options.pageNumbers ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' : ''}</w:p></w:ftr>`);
  zip.folder('docProps')?.file('core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title ?? '')}</dc:title><dc:subject>${xmlEscape(options.subject ?? '')}</dc:subject><dc:creator>${xmlEscape(options.author ?? 'next-work-dashboard')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
