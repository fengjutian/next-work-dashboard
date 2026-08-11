/**
 * Cleaner — 净化服务
 *
 * 提供：
 *  - getInjectionPayload(): 返回 { css, js, blockedDomains } 给 webview preload 注入
 *  - cleanHtml(html): 在 main 端对原始 HTML 字符串做"硬"净化（用于 Save as Markdown）
 */
import { htmlClean } from '../../core/work-browser/parser';
import { DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '../../core/work-browser/types';

export function getCleanerPayload(options: Partial<CleanOptions> = {}): { css: string; js: string; blockedDomains: string[] } {
  const merged: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  return htmlClean(merged);
}
