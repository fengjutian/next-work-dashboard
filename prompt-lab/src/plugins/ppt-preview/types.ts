/**
 * PPT Preview 模块 — 类型定义
 *
 * 独立于框架，后续可抽取为独立 package。
 */

export type PptMode = 'generate' | 'preview';
export type PptStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** 预览模式状态 */
export interface PptPreviewState {
  status: PptStatus;
  fileName: string | null;
  /** 解析出的幻灯片数量 */
  slideCount: number | null;
  /** 每张幻灯片的文本内容 */
  slides: SlideContent[] | null;
  error: string | null;
}

/** 单张幻灯片文本内容 */
export interface SlideContent {
  index: number;
  title: string;
  body: string;
}

/** 生成模式 — 单张幻灯片 */
export interface SlideDraft {
  id: string;
  title: string;
  content: string;
}

/** 生成模式状态 */
export interface PptGenerateState {
  slides: SlideDraft[];
  title: string;
  author: string;
}

export const INITIAL_PREVIEW_STATE: PptPreviewState = {
  status: 'idle',
  fileName: null,
  slideCount: null,
  slides: null,
  error: null,
};

export const INITIAL_GENERATE_STATE: PptGenerateState = {
  slides: [
    { id: crypto.randomUUID?.() ?? '1', title: '', content: '' },
  ],
  title: '',
  author: '',
};
