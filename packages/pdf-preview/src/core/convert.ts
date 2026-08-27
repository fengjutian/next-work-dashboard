/**
 * PDF Preview module — pdfjs-dist conversion / rendering.
 *
 * Pure functions. The host is expected to provide a configured
 * `pdfjs-dist` instance via the `PdfJsLoader` argument. The host's
 * loader is responsible for setting `GlobalWorkerOptions.workerSrc`
 * (e.g. via Vite's `?worker&url` import or a CDN URL).
 */

import type { PdfPreviewState } from './types';

/** Minimal surface of `pdfjs-dist` the package relies on. */
export interface PdfJsLib {
  getDocument: (params: { data: ArrayBuffer | Uint8Array }) => { promise: Promise<PdfDocumentProxy> };
  GlobalWorkerOptions?: { workerSrc?: string };
}

export interface PdfDocumentProxy {
  numPages: number;
  getPage: (pageNum: number) => Promise<PdfPageProxy>;
  destroy?: () => Promise<void> | void;
}

export interface PdfPageProxy {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (context: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
}

export type PdfJsLoader = () => Promise<PdfJsLib>;

/**
 * Load a PDF file and return the document proxy + metadata.
 */
export async function loadPdfDocument(
  file: File,
  loadPdfJs: PdfJsLoader,
): Promise<{ pdfDoc: PdfDocumentProxy; fileName: string; pageCount: number }> {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('仅支持 .pdf 格式文件');
  }

  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdfDoc.numPages;
  return { pdfDoc, fileName: file.name, pageCount };
}

/**
 * Render the given PDF page to a PNG data URL.
 */
export async function renderPageToImage(
  pdfDoc: PdfDocumentProxy,
  pageNum: number,
  scale: number,
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

/**
 * Load a PDF file and render its first page.
 * Mirrors the previous WordPreviewPanel-compatible state shape.
 */
export async function loadPdfFirstPage(
  file: File,
  loadPdfJs: PdfJsLoader,
  scale = 1,
): Promise<{ state: PdfPreviewState; pdfDoc: PdfDocumentProxy | null }> {
  try {
    const { pdfDoc, fileName, pageCount } = await loadPdfDocument(file, loadPdfJs);

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: {
        status: 'error',
        fileName: file.name,
        pageCount: 0,
        currentPage: 0,
        pageImageUrl: null,
        scale,
        error: message || 'PDF 解析失败，请确认文件格式正确',
      },
      pdfDoc: null,
    };
  }
}
