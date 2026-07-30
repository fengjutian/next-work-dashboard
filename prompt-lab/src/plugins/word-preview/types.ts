/**
 * Word Preview 模块 — 类型定义
 *
 * 独立于框架，后续可抽取为独立 package。
 */

export type PreviewStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface PreviewState {
  status: PreviewStatus;
  fileName: string | null;
  html: string | null;
  error: string | null;
}

export const INITIAL_PREVIEW_STATE: PreviewState = {
  status: 'idle',
  fileName: null,
  html: null,
  error: null,
};
