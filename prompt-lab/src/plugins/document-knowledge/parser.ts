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
    sections.push(section(`page-${page}`, `第 ${page} 页`, text.items.map((item: any) => item.str ?? '').join(' '), page));
  }
  return sections;
}

async function parseWord(file: File): Promise<DocumentSection[]> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const blocks = String(result.value).split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  return blocks.map((content, index) => section(`block-${index + 1}`, content.slice(0, 60), content));
}

async function parseExcel(file: File): Promise<DocumentSection[]> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  return workbook.SheetNames.map((name, index) => section(
    `sheet-${index + 1}`,
    name,
    XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false }),
  ));
}

async function parsePowerPoint(file: File): Promise<DocumentSection[]> {
  const { parsePptxFile } = await import('@/plugins/ppt-preview/convert');
  const result = await parsePptxFile(file);
  if (result.status === 'error' || !result.slides) throw new Error(result.error ?? 'PPTX 解析失败');
  return result.slides.map((slide) => section(
    `slide-${slide.index}`,
    slide.title || `第 ${slide.index} 页`,
    [slide.title, slide.body].filter(Boolean).join('\n'),
    slide.index,
  ));
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
