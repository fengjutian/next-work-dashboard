/**
 * PDF Preview 模块 — 入口
 *
 * 系统级内置 PDF 预览插件。逻辑已迁移到 `@next-work-dashboard/pdf-preview`。
 * 本文件保留 re-export 以保持向后兼容（built-in 仍然 `import { PdfPreviewPanel } from '../pdf-preview'`）。
 */

export { PdfPreviewPanel } from './PdfPreviewPanel';
export {
  loadPdfFirstPage,
  renderPageToImage,
  loadPdfDocument,
  INITIAL_PDF_STATE,
} from "@next-work-dashboard/pdf-preview/core";
export type { PdfPreviewState, PdfStatus } from "@next-work-dashboard/pdf-preview/core";
