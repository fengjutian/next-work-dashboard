import * as XLSX from 'xlsx';
import { getPdfJs } from '@/lib/pdfjs';

export interface ParsedAttachment {
  name: string;
  type: string;
  content: string;
  originalLength: number;
  truncated: boolean;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'xml',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'html', 'css', 'scss', 'less',
  'py', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb',
  'swift', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'env', 'gitignore',
]);

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : name.toLowerCase();
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const pageText = `## 第 ${pageNumber} 页\n${text.items.map((item: any) => item.str ?? '').join(' ')}`;
    pages.push(pageText);
  }
  return pages.join('\n\n');
}

async function parseDocx(file: File): Promise<string> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function parseSpreadsheet(file: File): Promise<string> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  return workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `## 工作表：${name}\n${csv}`;
  }).join('\n\n');
}

async function parsePptx(file: File): Promise<string> {
  const { parsePptxFile } = await import('@/plugins/ppt-preview/convert');
  const result = await parsePptxFile(file);
  if (result.status === 'error' || !result.slides) {
    throw new Error(result.error ?? 'PPTX 解析失败');
  }
  return result.slides.map((slide) =>
    `## 第 ${slide.index} 页${slide.title ? `：${slide.title}` : ''}\n${slide.body}`
  ).join('\n\n');
}

async function readBinaryAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 32_768;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `[二进制文件，Base64 原始内容]\n${btoa(binary)}`;
}

export async function parseAttachment(file: File): Promise<ParsedAttachment> {
  const extension = extensionOf(file.name);
  let raw: string;
  let type: string;

  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith('text/')) {
    raw = await file.text();
    type = extension || 'text';
  } else if (extension === 'pdf') {
    raw = await parsePdf(file);
    type = 'PDF';
  } else if (extension === 'docx') {
    raw = await parseDocx(file);
    type = 'Word';
  } else if (extension === 'xlsx' || extension === 'xls') {
    raw = await parseSpreadsheet(file);
    type = 'Excel';
  } else if (extension === 'pptx') {
    raw = await parsePptx(file);
    type = 'PowerPoint';
  } else {
    raw = await readBinaryAsBase64(file);
    type = `${extension || 'binary'}/base64`;
  }

  const content = raw.trim();
  return {
    name: file.name,
    type,
    content,
    originalLength: content.length,
    truncated: false,
  };
}

export function buildAttachmentContext(files: ParsedAttachment[]): string {
  return files.map((file) => [
    `<attachment name="${file.name}" type="${file.type}">`,
    file.content,
    '</attachment>',
  ].join('\n')).join('\n\n');
}
