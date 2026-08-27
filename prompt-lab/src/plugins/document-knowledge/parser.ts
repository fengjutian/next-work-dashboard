import * as XLSX from 'xlsx';
import { getPdfJs } from '@/lib/pdfjs';
import type { DocumentKind, DocumentSection, ParsedDocument } from './types';

const SUPPORTED = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx']);

export function isSupportedDocument(name: string): boolean {
  return SUPPORTED.has(name.split('.').pop()?.toLowerCase() ?? '');
}

function kindFor(name: string): DocumentKind {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'word';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (ext === 'pptx') return 'powerpoint';
  throw new Error(`不支持的文件格式：${ext || '未知'}`);
}

function section(id: string, title: string, content: string, page?: number): DocumentSection {
  return { id, title, content: content.replace(/\s+\n/g, '\n').trim(), page };
}

async function parsePdf(file: File): Promise<DocumentSection[]> {
  const pdfjs = await getPdfJs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const sections: DocumentSection[] = [];
  for (let page = 1; page <= document.numPages; page += 1) {
    const text = await (await document.getPage(page)).getTextContent();
    sections.push(section(`page-${page}`, `第 ${page} 页`, text.items.map((item: any) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join(''), page));
  }
  return sections;
}

async function parseWord(file: File): Promise<DocumentSection[]> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const document = new DOMParser().parseFromString(String(result.value), 'text/html');
  const sections: DocumentSection[] = [];
  let title = file.name;
  let chunks: string[] = [];
  const flush = () => {
    const content = chunks.filter(Boolean).join('\n\n').trim();
    if (content) sections.push(section(`section-${sections.length + 1}`, title, content));
    chunks = [];
  };
  for (const element of Array.from(document.body.children)) {
    if (/^H[1-6]$/.test(element.tagName)) {
      flush();
      title = element.textContent?.trim() || `章节 ${sections.length + 1}`;
      continue;
    }
    if (element.tagName === 'TABLE') {
      const rows = Array.from(element.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent?.trim() || '').join(' | '));
      chunks.push(rows.join('\n'));
    } else if (element.matches('ul,ol')) {
      chunks.push(Array.from(element.querySelectorAll(':scope > li')).map((item, index) => `${element.tagName === 'OL' ? `${index + 1}.` : '-'} ${item.textContent?.trim() || ''}`).join('\n'));
    } else {
      chunks.push(element.textContent?.trim() || '');
    }
  }
  flush();
  return sections;
}

async function parseExcel(file: File): Promise<DocumentSection[]> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellDates: true });
  return workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const formulas: string[] = [];
    const links: string[] = [];
    const comments: string[] = [];
    for (const [address, rawCell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue;
      const cell = rawCell as XLSX.CellObject;
      if (cell.f) formulas.push(`${address}: =${cell.f}`);
      if (cell.l?.Target) links.push(`${address}: ${cell.l.Target}`);
      for (const comment of cell.c || []) if (comment.t) comments.push(`${address}: ${comment.t}`);
    }
    const details = [
      XLSX.utils.sheet_to_csv(sheet, { blankrows: false }),
      formulas.length ? `### 公式\n${formulas.join('\n')}` : '',
      links.length ? `### 超链接\n${links.join('\n')}` : '',
      comments.length ? `### 批注\n${comments.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    return section(`sheet-${index + 1}`, name, details);
  });
}

async function parsePowerPoint(file: File): Promise<DocumentSection[]> {
  const [{ parsePptxFile }, JSZipModule] = await Promise.all([import('@next-work-dashboard/ppt-preview/core'), import('jszip')]);
  const [result, zip] = await Promise.all([parsePptxFile(file), new JSZipModule.default().loadAsync(await file.arrayBuffer())]);
  if (result.status === 'error' || !result.slides) throw new Error(result.error ?? 'PPTX 解析失败');
  return Promise.all(result.slides.map(async (slide) => {
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slide.index}.xml`);
    let notes = '';
    if (notesFile) {
      const xml = new DOMParser().parseFromString(await notesFile.async('text'), 'text/xml');
      notes = Array.from(xml.querySelectorAll('a\\:t, t')).map((node) => node.textContent?.trim() || '').filter(Boolean).join('\n');
    }
    return section(
      `slide-${slide.index}`,
      slide.title || `第 ${slide.index} 页`,
      [slide.title, slide.body, notes ? `### 演讲者备注\n${notes}` : ''].filter(Boolean).join('\n'),
      slide.index,
    );
  }));
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const kind = kindFor(file.name);
  const sections = kind === 'pdf' ? await parsePdf(file)
    : kind === 'word' ? await parseWord(file)
      : kind === 'excel' ? await parseExcel(file) : await parsePowerPoint(file);
  const id = `${file.name}-${file.size}-${file.lastModified}`;
  return {
    id, name: file.name, kind, size: file.size, sections,
    plainText: sections.map((item) => `## ${item.title}\n${item.content}`).join('\n\n'),
    previewUrl: kind === 'pdf' ? URL.createObjectURL(file) : undefined,
    createdAt: Date.now(),
  };
}
