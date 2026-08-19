import JSZip from 'jszip';

export interface PublicationChapter { path: string; title: string; markdown: string }
export interface PublicationBook { title: string; author: string; description?: string; language?: string; chapters: PublicationChapter[] }

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const plain = (value: string) => value.replace(/^---[\s\S]*?---\s*/m, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`>]/g, '').trim();
const paragraphs = (markdown: string) => plain(markdown).split(/\n\s*\n/).map((item) => item.replace(/^#{1,6}\s+/, '').trim()).filter(Boolean);

export async function createDocxBase64(book: PublicationBook): Promise<string> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="正文"/><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:pPr><w:spacing w:line="420" w:lineRule="auto"/><w:ind w:firstLineChars="200"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="书名"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="章标题"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`);
  const p = (text: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const body = [p(book.title, 'Title'), p(book.author), `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`, ...book.chapters.flatMap((chapter) => [p(chapter.title, 'Heading1'), ...paragraphs(chapter.markdown).map((text) => p(text))])].join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(book.title)}</dc:title><dc:creator>${xml(book.author)}</dc:creator><dc:description>${xml(book.description ?? '')}</dc:description></cp:coreProperties>`);
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

const concat = (...parts: Uint8Array[]) => { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; parts.forEach((part) => { output.set(part, offset); offset += part.length; }); return output; };
export async function createPdfBase64(book: PublicationBook): Promise<string> {
  const width = 1240; const height = 1754; const images: Uint8Array[] = [];
  const pages = [{ title: book.title, lines: [book.author, book.description ?? ''] }, ...book.chapters.flatMap((chapter) => {
    const lines = paragraphs(chapter.markdown).flatMap((item) => { const result: string[] = []; for (let index = 0; index < item.length; index += 30) result.push(item.slice(index, index + 30)); return result; });
    const chunks: Array<{ title: string; lines: string[] }> = []; for (let index = 0; index < lines.length; index += 21) chunks.push({ title: index ? `${chapter.title}（续）` : chapter.title, lines: lines.slice(index, index + 21) }); return chunks;
  })];
  for (const page of pages) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('当前环境无法生成 PDF');
    context.fillStyle = '#fffdfa'; context.fillRect(0, 0, width, height); context.fillStyle = '#251f22'; context.font = 'bold 52px serif'; context.fillText(page.title, 120, 160); context.font = '32px serif'; page.lines.forEach((line, index) => context.fillText(line, 120, 280 + index * 62));
    const binary = atob(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]); images.push(Uint8Array.from(binary, (char) => char.charCodeAt(0))); await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  const encoder = new TextEncoder(); const ascii = (value: string) => encoder.encode(value); const objects: Uint8Array[] = []; const pageIds = images.map((_, index) => 3 + index * 3);
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>'); objects[2] = ascii(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  images.forEach((image, index) => { const pageId = pageIds[index]; const content = ascii('q 595 0 0 842 0 0 cm /Im0 Do Q'); objects[pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`); objects[pageId + 1] = concat(ascii(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, ascii('\nendstream')); objects[pageId + 2] = concat(ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream')); });
  const chunks = [ascii('%PDF-1.4\n')]; const offsets = [0]; let offset = chunks[0].length; for (let id = 1; id < objects.length; id += 1) { offsets[id] = offset; const chunk = concat(ascii(`${id} 0 obj\n`), objects[id], ascii('\nendobj\n')); chunks.push(chunk); offset += chunk.length; }
  const xrefOffset = offset; chunks.push(ascii([`xref\n0 ${objects.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`].join('')));
  const bytes = concat(...chunks); let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary);
}

export async function createEpubBase64(book: PublicationBook): Promise<string> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.9;margin:8%;color:#211b20}h1{page-break-before:always}p{text-indent:2em}');
  book.chapters.forEach((chapter, index) => zip.file(`OEBPS/chapter-${index + 1}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${xml(chapter.title)}</h1>${paragraphs(chapter.markdown).map((text) => `<p>${xml(text)}</p>`).join('')}</body></html>`));
  const nav = book.chapters.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${xml(chapter.title)}</a></li>`).join('');
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><h1>目录</h1><ol>${nav}</ol></nav></body></html>`);
  const manifest = book.chapters.map((_, index) => `<item id="c${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = book.chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${xml(book.title)}</dc:title><dc:creator>${xml(book.author)}</dc:creator><dc:language>${xml(book.language ?? 'zh-CN')}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}</manifest><spine>${spine}</spine></package>`);
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}
