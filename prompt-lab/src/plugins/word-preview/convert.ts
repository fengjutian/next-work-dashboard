/**
 * Word Preview 模块 — mammoth.js 转换逻辑
 *
 * 纯函数，不依赖 React / DOM。
 * 后续可独立抽取为 @next-work/word-converter。
 */

import type { PreviewState } from './types';

export async function convertDocxToHtml(file: File): Promise<PreviewState> {
  if (!file.name.endsWith('.docx')) {
    return {
      status: 'error',
      fileName: file.name,
      html: null,
      error: '仅支持 .docx 格式文件',
    };
  }

  try {
    const mammoth: any = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });

    if (result.messages.length > 0) {
      console.warn('[WordPreview] mammoth conversion messages:', result.messages);
    }

    return {
      status: 'loaded',
      fileName: file.name,
      html: result.value,
      error: null,
    };
  } catch (err: any) {
    return {
      status: 'error',
      fileName: file.name,
      html: null,
      error: err?.message ?? '文件解析失败，请确认文件格式正确',
    };
  }
}
