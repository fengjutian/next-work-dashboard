import JSZip from 'jszip';
import type { HanyuJinjieExecution } from '@/db';

export interface BookMetadata { title: string; author: string; description: string }

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const safeName = (value: string) => value.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 60) || '汉语新解集';
const downloadBlob = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000); };

function chapterDocument(entry: HanyuJinjieExecution): string {
  const svg = /<svg\b[^>]*\bxmlns=/i.test(entry.svgContent) ? entry.svgContent : entry.svgContent.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(entry.word)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body><article><h1>${escapeXml(entry.word)}</h1><div class="card">${svg}</div><section><h2>一针见血</h2><p>${escapeXml(entry.explanation)}</p></section></article></body></html>`;
}

export async function exportEpub(metadata: BookMetadata, entries: HanyuJinjieExecution[]): Promise<void> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/style.css', `body{font-family:serif;line-height:1.9;color:#211b20;margin:8%}h1{text-align:center;margin-bottom:1.5em}h2{font-size:1.1em;margin-top:2em}.card{text-align:center;page-break-after:always}.card svg{width:100%;max-width:400px;height:auto}p{text-indent:2em}.cover{display:flex;min-height:80vh;flex-direction:column;justify-content:center;text-align:center}.cover h1{font-size:2.4em}.muted{color:#766873}`);
  zip.file('OEBPS/cover.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(metadata.title)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head><body><div class="cover"><h1>${escapeXml(metadata.title)}</h1><p>${escapeXml(metadata.author)}</p><p class="muted">${escapeXml(metadata.description)}</p></div></body></html>`);
  entries.forEach((entry, index) => zip.file(`OEBPS/chapter-${index + 1}.xhtml`, chapterDocument(entry)));
  const navItems = entries.map((entry, index) => `<li><a href="chapter-${index + 1}.xhtml">${escapeXml(entry.word)}</a></li>`).join('');
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${navItems}</ol></nav></body></html>`);
  const manifest = entries.map((_, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = entries.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${escapeXml(metadata.title)}</dc:title><dc:creator>${escapeXml(metadata.author)}</dc:creator><dc:language>zh-CN</dc:language><dc:description>${escapeXml(metadata.description)}</dc:description><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}</manifest><spine><itemref idref="cover"/>${spine}</spine></package>`);
  downloadBlob(await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' }), `${safeName(metadata.title)}.epub`);
}

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;

function pageCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas'); canvas.width = PAGE_WIDTH; canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext('2d'); if (!context) throw new Error('当前环境无法创建 PDF 页面');
  context.fillStyle = '#fbf8f5'; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT); return context;
}

function drawCentered(context: CanvasRenderingContext2D, text: string, y: number, font: string, color = '#291d28') {
  context.font = font; context.fillStyle = color; context.textAlign = 'center'; context.fillText(text, PAGE_WIDTH / 2, y);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []; let line = '';
  for (const character of text) { const next = line + character; if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = character; } else line = next; }
  if (line) lines.push(line); return lines;
}

async function svgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try { const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('卡片图片加载失败')); image.src = url; }); return image; }
  finally { URL.revokeObjectURL(url); }
}

function jpegBytes(context: CanvasRenderingContext2D): Uint8Array {
  const base64 = context.canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  const binary = atob(base64); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function renderPdfPages(metadata: BookMetadata, entries: HanyuJinjieExecution[]): Promise<Uint8Array[]> {
  const pages: Uint8Array[] = [];
  let context = pageCanvas();
  context.fillStyle = '#6d2264'; context.fillRect(0, 0, PAGE_WIDTH, 26);
  drawCentered(context, metadata.title, 650, 'bold 78px "Microsoft YaHei", sans-serif');
  drawCentered(context, metadata.author || '佚名', 760, '32px "Microsoft YaHei", sans-serif', '#765f72');
  context.font = '28px "Microsoft YaHei", sans-serif'; context.textAlign = 'center'; context.fillStyle = '#765f72';
  wrapText(context, metadata.description, 820).slice(0, 4).forEach((line, index) => context.fillText(line, PAGE_WIDTH / 2, 900 + index * 48));
  pages.push(jpegBytes(context));
  context = pageCanvas(); drawCentered(context, '目录', 180, 'bold 54px "Microsoft YaHei", sans-serif');
  context.font = '30px "Microsoft YaHei", sans-serif'; context.textAlign = 'left'; context.fillStyle = '#382c36';
  entries.forEach((entry, index) => { const column = Math.floor(index / 18); const row = index % 18; context.fillText(`${String(index + 1).padStart(2, '0')}  ${entry.word}`, 170 + column * 500, 300 + row * 68); });
  pages.push(jpegBytes(context));
  for (const [index, entry] of entries.entries()) {
    context = pageCanvas(); drawCentered(context, `${index + 1} / ${entries.length}  ${entry.word}`, 90, '28px "Microsoft YaHei", sans-serif', '#765f72');
    const image = await svgImage(entry.svgContent); const height = 1500; const width = height * (image.naturalWidth || 400) / (image.naturalHeight || 600);
    context.drawImage(image, (PAGE_WIDTH - width) / 2, 135, width, height); pages.push(jpegBytes(context));
    context = pageCanvas(); drawCentered(context, entry.word, 250, 'bold 64px "Microsoft YaHei", sans-serif'); drawCentered(context, '一针见血', 355, 'bold 30px "Microsoft YaHei", sans-serif', '#6d2264');
    context.font = '36px "Microsoft YaHei", sans-serif'; context.textAlign = 'left'; context.fillStyle = '#332830';
    wrapText(context, entry.explanation, 900).forEach((line, lineIndex) => context.fillText(line, 170, 500 + lineIndex * 64)); pages.push(jpegBytes(context));
  }
  return pages;
}

function buildImagePdf(images: Uint8Array[]): Blob {
  const encoder = new TextEncoder(); const objects: Uint8Array[] = [];
  const ascii = (value: string) => encoder.encode(value);
  const join = (...parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
  const pageIds = images.map((_, index) => 3 + index * 3);
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = ascii(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  images.forEach((image, index) => { const pageId = pageIds[index]; const imageId = pageId + 1; const contentId = pageId + 2; const content = ascii('q 595 0 0 842 0 0 cm /Im0 Do Q');
    objects[pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects[imageId] = join(ascii(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, ascii('\nendstream'));
    objects[contentId] = join(ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream'));
  });
  const chunks: Uint8Array[] = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; const offsets = [0]; let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id++) { offsets[id] = offset; const chunk = join(ascii(`${id} 0 obj\n`), objects[id], ascii('\nendobj\n')); chunks.push(chunk); offset += chunk.length; }
  const xrefOffset = offset; const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`].join('');
  return new Blob([...chunks, ascii(xref)], { type: 'application/pdf' });
}

export async function exportPdf(metadata: BookMetadata, entries: HanyuJinjieExecution[]): Promise<void> {
  downloadBlob(buildImagePdf(await renderPdfPages(metadata, entries)), `${safeName(metadata.title)}.pdf`);
}
