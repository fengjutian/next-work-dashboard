/**
 * Host capabilities consumed by the PDF preview panel.
 *
 * Hosts must provide a configured `pdfjs-dist` instance via
 * `getPdfJs` — typically they import pdfjs, set
 * `GlobalWorkerOptions.workerSrc` (e.g. via Vite's `?worker&url`
 * import or a CDN URL), and return the library.
 */

import type { PdfJsLoader } from '../core/convert';

export type { PdfJsLoader, PdfJsLib, PdfDocumentProxy, PdfPageProxy } from '../core/convert';

export interface PdfPreviewAdapter {
  /**
   * Return a configured `pdfjs-dist` instance. The host is expected
   * to set `GlobalWorkerOptions.workerSrc` before returning.
   */
  getPdfJs: PdfJsLoader;
}
