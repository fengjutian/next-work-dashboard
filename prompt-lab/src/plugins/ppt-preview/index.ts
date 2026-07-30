/**
 * PPT Preview 模块 — 入口
 *
 * 独立文件夹结构：
 *  - PptPreviewPanel → 面板 React 组件（生成 + 预览双模式）
 *  - convert          → 纯函数（解析 .pptx 和 生成 .pptx）
 *  - types            → 类型定义
 */

export { PptPreviewPanel } from './PptPreviewPanel';
export { parsePptxFile, generatePptx } from './convert';
export type {
  PptMode,
  PptStatus,
  PptPreviewState,
  PptGenerateState,
  SlideContent,
  SlideDraft,
} from './types';
export { INITIAL_PREVIEW_STATE, INITIAL_GENERATE_STATE } from './types';
