// ── 注入引擎 — 纯函数，不依赖 React / Electron ──

import type { SiteConfig, InjectMode, InjectStrategy } from '@/store';

// ── 变量提取与替换 ──

/**
 * 从提示词内容中提取 {{变量名}} 
 */
export function extractVariables(content: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * 用给定值替换提示词中的 {{变量名}}
 */
export function fillVariables(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? `{{${name}}}`);
}

// ── 注入脚本生成 ──

export interface InjectOptions {
  site: SiteConfig;
  text: string;
  mode: InjectMode;
  strategy: InjectStrategy;
}

/**
 * 构建注入到 webview 的 JavaScript 脚本。
 * 纯字符串拼接，不依赖任何运行时环境。
 */
export function buildInjectionScript(opts: InjectOptions): string {
  const { site, text, mode, strategy } = opts;
  const autoSubmit = mode === 'fill-and-submit';
  const safeText = JSON.stringify(text);
  const appendMode = strategy === 'append';

  return `
    (function() {
      const input = document.querySelector('${site.inputSelector}');
      if (!input) return JSON.stringify({ success: false, error: 'INPUT_NOT_FOUND' });

      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, ${appendMode} ? (input.value + ${safeText}) : ${safeText});
      } else {
        input.value = ${appendMode} ? (input.value + ${safeText}) : ${safeText};
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      ${
        autoSubmit && site.submitSelector
          ? `setTimeout(() => {
               const btn = document.querySelector('${site.submitSelector}');
               if (btn) btn.click();
             }, 200);`
          : ''
      }

      return JSON.stringify({ success: true });
    })();
  `;
}

// ── 注入结果解析 ──

export interface InjectResult {
  success: boolean;
  error?: string;
}

/**
 * 解析 webview.executeJavaScript 返回的结果
 */
export function parseInjectResult(raw: string): InjectResult {
  try {
    return JSON.parse(raw) as InjectResult;
  } catch {
    return { success: false, error: 'PARSE_ERROR' };
  }
}
