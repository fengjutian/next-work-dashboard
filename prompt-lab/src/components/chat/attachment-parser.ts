import * as XLSX from 'xlsx';

export interface ParsedAttachment {
  name: string;
  type: string;
  content: string;
  originalLength: number;
  truncated: boolean;
}

export const MAX_ATTACHMENT_CHARS = 60_000;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

function limitContent(content: string) {
  const originalLength = content.length;
  if (originalLength <= MAX_ATTACHMENT_CHARS) {
    return { content, originalLength, truncated: false };
  }
  return {
    content: `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[内容过长，已截断]`,
    originalLength,
    truncated: true,
  };
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist');
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages: string[] = [];
  let length = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const pageText = `## 第 ${pageNumber} 页\n${text.items.map((item: any) => item.str ?? '').join(' ')}`;
    pages.push(pageText);
    length += pageText.length;
    if (length >= MAX_ATTACHMENT_CHARS) break;
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

export async function parseAttachment(file: File): Promise<ParsedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`文件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB 限制`);
  }
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
    throw new Error(`暂不支持 .${extension || '未知'} 文件`);
  }

  return { name: file.name, type, ...limitContent(raw.trim()) };
}

export function buildAttachmentContext(files: ParsedAttachment[]): string {
  return files.map((file) => [
    `<attachment name="${file.name}" type="${file.type}">`,
    file.content,
    '</attachment>',
  ].join('\n')).join('\n\n');
}
