/**
 * PDF Preview module — type definitions.
 *
 * Host-agnostic. Consumed by the React layer in `../react`.
 */

export type PdfStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface PdfPreviewState {
  status: PdfStatus;
  fileName: string | null;
  pageCount: number;
  currentPage: number;
  /** Current page rendered as a data URL (for `<img>` display). */
  pageImageUrl: string | null;
  /** Zoom scale, 1 = 100% */
  scale: number;
  error: string | null;
}

export const INITIAL_PDF_STATE: PdfPreviewState = {
  status: 'idle',
  fileName: null,
  pageCount: 0,
  currentPage: 1,
  pageImageUrl: null,
  scale: 1,
  error: null,
};
