/**
 * Annotation 数据模型
 *
 * Phase 1：只定义数据形态 + 选择器规范化。Phase 2 再做 highlight 渲染。
 */
import type { Annotation, AnnotationColor, DocumentId, AnnotationId } from '../types';
import { newId, now } from '../types';

export function createAnnotation(params: {
  documentId: DocumentId;
  rangeText: string;
  selector: string;
  color?: AnnotationColor;
  note?: string;
}): Annotation {
  const t = now();
  return {
    id: newId<AnnotationId>(),
    documentId: params.documentId,
    rangeText: params.rangeText,
    selector: params.selector,
    color: params.color || 'yellow',
    note: params.note || '',
    createdAt: t,
    updatedAt: t,
  };
}

/**
 * 选择器规范化：去 script/style/动态 ID；
 * 粗略转 XPath-like → CSS 形式。Phase 1 只做"原样保留 + 长度截断"。
 */
export function normalizeSelector(selector: string, maxLength = 2000): string {
  let s = selector.trim();
  if (s.length > maxLength) s = s.slice(0, maxLength);
  return s;
}
