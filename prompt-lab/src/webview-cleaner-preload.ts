/**
 * webview-cleaner-preload.ts — 净化注入（work-browser 专属）
 *
 * 由 forge.config.ts build 成 webview-cleaner-preload.js
 * 在 <webview partition="persist:work-browser"> 加载页面时执行。
 *
 * 职责：
 *  1. 从 main 端拉 cleaner payload（CSS 选择器 + 注入 JS）
 *  2. 在 DOMContentLoaded 后注入 CSS + 执行净化 JS
 *  3. 监听 selectionchange，把选区信息发到渲染端（用于 Annotation 浮动菜单）
 *  4. 监听净化规则命中，统计发回 main
 */
import { ipcRenderer } from 'electron';

interface CleanerPayload {
  css: string;
  js: string;
  blockedDomains: string[];
}

async function getPayload(): Promise<CleanerPayload | null> {
  try {
    return await ipcRenderer.invoke('work-browser:cleaner:webview-payload');
  } catch {
    return null;
  }
}

function injectStyle(css: string) {
  if (!css) return;
  const style = document.createElement('style');
  style.setAttribute('data-work-browser-cleaner', '');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
}

function runCleanerScript(js: string) {
  if (!js) return;
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(js);
  } catch (e) {
    console.warn('[work-browser cleaner] inject failed:', e);
  }
}

let lastSelection = '';
function reportSelection() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) {
    if (lastSelection !== '') {
      lastSelection = '';
      ipcRenderer.sendToHost('work-browser:selection-cleared');
    }
    return;
  }
  const text = sel.toString().trim();
  if (!text || text === lastSelection) return;
  if (text.length < 2 || text.length > 2000) return;
  lastSelection = text;
  // 提取选区所在的 path（简化为类名/id 拼接）
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container.nodeType === 1 ? (container as Element) : container.parentElement;
  const selector = el ? buildSelector(el) : '';
  ipcRenderer.sendToHost('work-browser:selection-changed', { text, selector });
}

function buildSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 6 && cur !== document.body) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) { part += `#${cur.id}`; parts.unshift(part); break; }
    if (cur.className && typeof cur.className === 'string') {
      const cls = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) part += `.${cls}`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

async function main() {
  const payload = await getPayload();
  if (!payload) return;

  const apply = () => {
    injectStyle(payload.css);
    runCleanerScript(payload.js);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  // SPA 重新插入：监听 URL 变化重新注入
  const reapply = () => apply();
  window.addEventListener('popstate', reapply);
  window.addEventListener('hashchange', reapply);

  // 选区监听
  document.addEventListener('selectionchange', reportSelection, true);
}

void main();
