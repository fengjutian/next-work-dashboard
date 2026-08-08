/**
 * 预览插件 → AI 工具桥接层
 *
 * 将 Word/Excel/PPT/PDF 预览插件的文件解析能力暴露给 AI Agent。
 * 每个工具接受文件路径，读取文件，提取文本内容，返回给 LLM。
 *
 * 复用现有插件的 convert.ts 逻辑（动态 import）。
 */

import type { ToolDefinition } from './types';
import { officeTools } from './office-tools';

// ── 工具函数：按路径读取文件，返回 ArrayBuffer ──

async function readFileAsBuffer(filePath: string): Promise<ArrayBuffer> {
  const api = (window as any).electronAPI;
  if (api?.readFileBuffer) {
    const result = await api.readFileBuffer(filePath);
    if (!result?.success || !result?.data) {
      throw new Error(result?.error ?? '读取文件失败');
    }
    // base64 → ArrayBuffer
    const binary = atob(result.data);
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i);
    }
    return buf;
  }
  // fallback: 浏览器环境尝试 fetch
  const resp = await fetch(`file://${filePath}`);
  if (!resp.ok) throw new Error(`读取文件失败: HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

function createFileFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): File {
  return new File([buffer], fileName);
}

// ── 辅助：HTML → 纯文本 ──

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── PDF 读取工具 ──

const readPdfTool: ToolDefinition = {
  name: 'read_pdf_document',
  description: '读取 PDF 文件并提取全部文本内容，支持大型文档。返回每页的文本。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'PDF 文件的绝对路径' },
      maxPages: { type: 'number', description: '最大读取页数，默认 20（留空则读取全部）' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    const maxPages = args.maxPages ? Number(args.maxPages) : 9999;

    try {
      const buffer = await readFileAsBuffer(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;

      const { getPdfJs } = await import('@/lib/pdfjs');
      const pdfjsLib = await getPdfJs();

      // 设置 worker 路径
      if (!pdfjsLib.GlobalWorkerOptions?.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
      }

      const pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      const pageCount = Math.min(pdfDoc.numPages, maxPages);
      const pages: string[] = [];

      for (let i = 1; i <= pageCount; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        pages.push(`--- 第 ${i} 页 ---\n${text.trim()}`);
      }

      const fullText = pages.join('\n\n');
      const summary = `文件名: ${fileName}\n总页数: ${pdfDoc.numPages}${pageCount < pdfDoc.numPages ? `（已读取前 ${pageCount} 页）` : ''}\n\n`;

      return summary + fullText;
    } catch (err: any) {
      return `读取 PDF 失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── Word 读取工具 ──

const readWordTool: ToolDefinition = {
  name: 'read_word_document',
  description: '读取 Word (.docx) 文件并提取文本内容。支持 Microsoft Word、Google Docs、LibreOffice 导出的文档。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Word 文件的绝对路径' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    try {
      const buffer = await readFileAsBuffer(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;

      const mammoth: any = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

      const plainText = htmlToText(result.value);

      return `文件名: ${fileName}\n\n${plainText}`;
    } catch (err: any) {
      return `读取 Word 文档失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── Excel 读取工具 ──

const readExcelTool: ToolDefinition = {
  name: 'read_excel_spreadsheet',
  description: '读取 Excel (.xlsx/.xls) 文件，提取所有工作表的数据为表格文本。适合分析销售数据、财务报表、统计表格等。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Excel 文件的绝对路径' },
      sheetIndex: { type: 'number', description: '工作表索引（从 0 开始），不填则读取所有工作表' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    const sheetIndex = args.sheetIndex !== undefined ? Number(args.sheetIndex) : -1;

    try {
      const buffer = await readFileAsBuffer(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;

      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

      let output = `文件名: ${fileName}\n工作表数: ${wb.SheetNames.length}\n\n`;

      const targetSheets = sheetIndex >= 0
        ? [wb.SheetNames[sheetIndex]].filter(Boolean)
        : wb.SheetNames;

      for (const name of targetSheets) {
        const ws = wb.Sheets[name];
        // 转为 CSV 格式文本
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
        // 限制每个工作表最多 200 行
        const lines = csv.split('\n');
        const truncated = lines.length > 200
          ? lines.slice(0, 200).join('\n') + `\n...（共 ${lines.length} 行，仅显示前 200 行）`
          : csv;

        output += `═══ 工作表: ${name} ═══\n${truncated}\n\n`;
      }

      return output.trim();
    } catch (err: any) {
      return `读取 Excel 失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── PPT 读取工具 ──

const readPptTool: ToolDefinition = {
  name: 'read_ppt_presentation',
  description: '读取 PowerPoint (.pptx) 文件，提取所有幻灯片的标题和正文文本。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'PPT 文件的绝对路径' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    try {
      const buffer = await readFileAsBuffer(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const zipData = await zip.loadAsync(buffer);

      // 获取所有幻灯片 XML
      const slideFiles = Object.keys(zipData.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
          const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
          return na - nb;
        });

      const slides: string[] = [];

      for (let i = 0; i < slideFiles.length; i++) {
        const xmlStr = await zipData.files[slideFiles[i]].async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlStr, 'text/xml');

        // 提取所有 <a:t> 文本
        const textNodes = doc.querySelectorAll('a\\:t, t');
        const allText = Array.from(textNodes)
          .map((n) => n.textContent?.trim() ?? '')
          .filter(Boolean);

        const title = allText[0] ?? '';
        const body = allText.slice(1).join('\n');

        slides.push(`--- 幻灯片 ${i + 1} ---\n标题: ${title}\n${body ? `内容:\n${body}` : '(无正文)'}`);
      }

      return `文件名: ${fileName}\n幻灯片数: ${slides.length}\n\n${slides.join('\n\n')}`;
    } catch (err: any) {
      return `读取 PPT 失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── 图片信息工具 ──

const readImageTool: ToolDefinition = {
  name: 'open_image',
  description: '打开图片文件查看。返回图片的基本信息（尺寸、格式、大小），并告知用户已打开图片预览。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '图片文件的绝对路径' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    try {
      const api = (window as any).electronAPI;
      let base64Data: string;
      let mimeType = 'image/png';
      let fileName = filePath.split(/[/\\]/).pop() || filePath;
      let fileSize = 0;

      if (api?.readFileBuffer) {
        const result = await api.readFileBuffer(filePath);
        if (!result?.success || !result?.data) {
          throw new Error(result?.error ?? '读取文件失败');
        }
        base64Data = result.data;
        mimeType = result.mimeType ?? mimeType;
        fileName = result.name ?? fileName;
        fileSize = result.size ?? 0;
      } else {
        const resp = await fetch(`file://${filePath}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        fileSize = blob.size;
        base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }

      // 尝试获取图片实际尺寸
      let dimensions = '未知';
      try {
        const imgSrc = `data:${mimeType};base64,${base64Data}`;
        dimensions = await new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(`${img.naturalWidth} × ${img.naturalHeight} 像素`);
          img.onerror = () => resolve('无法读取');
          img.src = imgSrc;
        });
      } catch { /* ignore */ }

      const sizeKB = (fileSize / 1024).toFixed(1);
      const formatMap: Record<string, string> = {
        'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP',
        'image/gif': 'GIF', 'image/svg+xml': 'SVG', 'image/bmp': 'BMP',
      };

      return [
        `📷 图片: ${fileName}`,
        `格式: ${formatMap[mimeType] ?? mimeType}`,
        `大小: ${sizeKB} KB`,
        `尺寸: ${dimensions}`,
        '',
        '提示：用户已收到图片预览通知，可在面板中查看图片。',
      ].join('\n');
    } catch (err: any) {
      return `打开图片失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── 通用文件阅读工具 ──

const readFileContentTool: ToolDefinition = {
  name: 'read_file_content',
  description: '读取文本文件（.txt .md .json .csv .xml .yaml .yml .log .env .cfg 等）的内容。对于二进制文件（PDF/Word/Excel/PPT/图片）请使用专门的工具。',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '文件绝对路径' },
      encoding: { type: 'string', description: '编码，默认 utf-8', enum: ['utf-8', 'gbk', 'gb2312'] },
      maxLength: { type: 'number', description: '最大读取字符数，默认 5000' },
    },
    required: ['filePath'],
  },
  execute: async (args) => {
    const filePath = String(args.filePath);
    const maxLength = args.maxLength ? Number(args.maxLength) : 5000;
    try {
      const api = (window as any).electronAPI;
      if (api?.readFileBuffer) {
        const result = await api.readFileBuffer(filePath);
        if (!result?.success || !result?.data) {
          throw new Error(result?.error ?? '读取文件失败');
        }
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        // 尝试用 TextDecoder 解码
        const decoder = new TextDecoder(args.encoding === 'gbk' || args.encoding === 'gb2312' ? 'gbk' : 'utf-8');
        const text = decoder.decode(bytes);
        const fileName = result.name ?? filePath.split(/[/\\]/).pop() ?? filePath;
        const truncated = text.length > maxLength
          ? text.slice(0, maxLength) + `\n\n...(文件共 ${text.length} 字符，仅显示前 ${maxLength} 字符)`
          : text;

        return `文件名: ${fileName}\n大小: ${result.size} bytes\n\n${truncated}`;
      }

      // fallback
      const resp = await fetch(`file://${filePath}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const truncated = text.length > maxLength
        ? text.slice(0, maxLength) + `\n\n...(truncated)`
        : text;
      return truncated;
    } catch (err: any) {
      return `读取文件失败: ${err?.message ?? '未知错误'}`;
    }
  },
};

// ── 导出所有插件工具 ──

export const pluginTools: ToolDefinition[] = [
  readPdfTool,
  readWordTool,
  readExcelTool,
  readPptTool,
  readImageTool,
  readFileContentTool,
  ...officeTools,
];
