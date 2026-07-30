/**
 * Word Preview 模块 — 入口
 *
 * 独立文件夹，后续可抽取为独立 package。
 *
 * 导出：
 *  - WordPreviewPanel  → 面板 React 组件
 *  - convertDocxToHtml → 纯转换函数（可独立使用）
 *  - types              → 类型定义
 */

export { WordPreviewPanel } from './WordPreviewPanel';
export { convertDocxToHtml } from './convert';
export type { PreviewState, PreviewStatus } from './types';
export { INITIAL_PREVIEW_STATE } from './types';
