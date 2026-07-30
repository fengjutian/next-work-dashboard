/**
 * PDF Preview 模块 — 类型定义
 *
 * 独立于框架，后续可抽取为独立 package。
 */

export type PdfStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface PdfPreviewState {
  status: PdfStatus;
  fileName: string | null;
  pageCount: number;
  currentPage: number;
  /** 当前页渲染为 data URL（用于 <img> 显示） */
  pageImageUrl: string | null;
  /** 缩放比例，1 = 100% */
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
