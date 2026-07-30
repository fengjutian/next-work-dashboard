/**
 * PDF Preview 模块 — 入口
 *
 * 系统级内置 PDF 预览插件。
 *
 * 导出：
 *  - PdfPreviewPanel → 面板 React 组件
 *  - loadPdfFirstPage / renderPageToImage → 纯渲染函数
 *  - types → 类型定义
 */

export { PdfPreviewPanel } from './PdfPreviewPanel';
export { loadPdfFirstPage, renderPageToImage, loadPdfDocument } from './convert';
export type { PdfPreviewState, PdfStatus } from './types';
export { INITIAL_PDF_STATE } from './types';
