/**
 * PDF Preview 模块 — PDF.js 转换/渲染逻辑
 *
 * 纯函数，不依赖 React / DOM。
 * 使用 pdfjs-dist 将 PDF 页面渲染为图片。
 */

import type { PdfPreviewState } from './types';

/**
 * 将 PDF 文件解析为内部数据结构。
 * 返回 { pdfDoc, fileName }，供后续页面渲染。
 */
export async function loadPdfDocument(
  file: File,
): Promise<{ pdfDoc: any; fileName: string; pageCount: number }> {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('仅支持 .pdf 格式文件');
  }

  const pdfjsLib: any = await import('pdfjs-dist');

  // 设置 worker 路径
  if (!pdfjsLib.GlobalWorkerOptions?.workerSrc) {
    // 使用 unpkg CDN 的 worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdfDoc.numPages;

  return { pdfDoc, fileName: file.name, pageCount };
}

/**
 * 渲染 PDF 的指定页面为图片 data URL。
 * @param pdfDoc  已加载的 PDF 文档对象
 * @param pageNum 页码（从 1 开始）
 * @param scale   缩放比例（1 = 100%）
 * @returns data URL (image/png)
 */
export async function renderPageToImage(
  pdfDoc: any,
  pageNum: number,
  scale: number,
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d')!;
  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;

  return canvas.toDataURL('image/png');
}

/**
 * 加载并渲染 PDF 文件的第一页。
 * 兼容已有的 WordPreviewPanel 状态模式。
 */
export async function loadPdfFirstPage(
  file: File,
  scale = 1,
): Promise<{ state: PdfPreviewState; pdfDoc: any }> {
  try {
    const { pdfDoc, fileName, pageCount } = await loadPdfDocument(file);

    if (pageCount === 0) {
      return {
        state: {
          status: 'error',
          fileName,
          pageCount: 0,
          currentPage: 0,
          pageImageUrl: null,
          scale,
          error: 'PDF 文件没有页面',
        },
        pdfDoc: null,
      };
    }

    const pageImageUrl = await renderPageToImage(pdfDoc, 1, scale);

    return {
      state: {
        status: 'loaded',
        fileName,
        pageCount,
        currentPage: 1,
        pageImageUrl,
        scale,
        error: null,
      },
      pdfDoc,
    };
  } catch (err: any) {
    return {
      state: {
        status: 'error',
        fileName: file.name,
        pageCount: 0,
        currentPage: 0,
        pageImageUrl: null,
        scale,
        error: err?.message ?? 'PDF 解析失败，请确认文件格式正确',
      },
      pdfDoc: null,
    };
  }
}
