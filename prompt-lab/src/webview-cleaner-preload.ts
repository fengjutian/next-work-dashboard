/**
 * webview-cleaner-preload.ts — 净化注入 + Annotation 高亮回放
 *
 * 由 forge.config.ts build 成 webview-cleaner-preload.js
 * 在 <webview partition="persist:work-browser"> 加载页面时执行。
 *
 * 职责：
 *  1. 从 main 端拉 cleaner payload（CSS 选择器 + 注入 JS）
 *  2. 在 DOMContentLoaded 后注入 CSS + 执行净化 JS
 *  3. 监听 selectionchange，把选区信息发到渲染端（Annotation 浮动菜单）
 *  4. Annotation 高亮回放：did-finish-load 后查 list → 渲染高亮
 *  5. 点击高亮 → 把 annotation 发到渲染端（用于弹笔记）
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

function injectBrowserChromeStyle() {
  if (document.querySelector('[data-work-browser-chrome]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-work-browser-chrome', '');
  style.textContent = `
    :root { scrollbar-width: thin !important; scrollbar-color: rgba(97,36,91,.32) transparent !important; }
    html, body { scrollbar-width: thin !important; scrollbar-color: rgba(97,36,91,.32) transparent !important; }
    ::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
    ::-webkit-scrollbar-track { background: transparent !important; }
    ::-webkit-scrollbar-thumb {
      min-width: 32px !important; min-height: 32px !important;
      border: 2px solid transparent !important; border-radius: 999px !important;
      background: rgba(97,36,91,.24) !important; background-clip: padding-box !important;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(97,36,91,.48) !important; background-clip: padding-box !important; }
    ::-webkit-scrollbar-corner { background: transparent !important; }
  `;
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

function interceptNewWindowLinks(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(target instanceof HTMLAnchorElement)) return;
  const opensNewWindow = target.target.toLowerCase() === '_blank' || event.ctrlKey || event.metaKey;
  if (!opensNewWindow) return;
  const url = target.href;
  if (!/^https?:\/\//i.test(url)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.sendToHost('work-browser:open-url', { url });
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
  injectBrowserChromeStyle();
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
  const reapply = () => {
    apply();
    // URL 变了，重新拉 annotations
    void loadAnnotations();
  };
  window.addEventListener('popstate', reapply);
  window.addEventListener('hashchange', reapply);

  // 选区监听
  document.addEventListener('selectionchange', reportSelection, true);
  // 网站的 target=_blank / Ctrl+Click 统一交给宿主创建内部 Tab，禁止弹独立窗口。
  document.addEventListener('click', interceptNewWindowLinks, true);

  // Annotation 高亮回放：等首屏稳定后拉取
  window.addEventListener('load', () => {
    // 给主进程 100ms 让 SPAs 完成 first render
    setTimeout(() => void loadAnnotations(), 100);
  });
  // 兜底：did-finish-load 也会触发（通过 sendToHost）— 实际由渲染端用 webContents.executeJavaScript 调用
  ipcRenderer.on('work-browser:inject-annotations', () => void loadAnnotations());
}

interface AnnotationItem {
  id: string;
  selector: string;
  rangeText: string;
  note: string;
  color: 'yellow' | 'green' | 'red' | 'blue' | 'purple';
}

function buildFallbackSelector(text: string): string {
  // 简单回退：在主内容里找首个包含该文字的元素
  if (!text) return '';
  const all = document.body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, span, td, div');
  for (const el of Array.from(all)) {
    if (el.textContent && el.textContent.includes(text) && el.children.length < 5) {
      return buildSelectorPath(el);
    }
  }
  return '';
}

function buildSelectorPath(el: Element): string {
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

const COLOR_BG: Record<AnnotationItem['color'], string> = {
  yellow: 'rgba(255, 235, 59, 0.45)',
  green: 'rgba(76, 175, 80, 0.4)',
  red: 'rgba(244, 67, 54, 0.4)',
  blue: 'rgba(33, 150, 243, 0.4)',
  purple: 'rgba(171, 71, 188, 0.4)',
};

const COLOR_BORDER: Record<AnnotationItem['color'], string> = {
  yellow: '#fbc02d', green: '#2e7d32', red: '#c62828', blue: '#1565c0', purple: '#6a1b9a',
};

function renderAnnotation(a: AnnotationItem) {
  // 清理旧 wrapper
  document.querySelectorAll(`[data-work-browser-annotation-id="${a.id}"]`).forEach((n) => n.remove());

  let target: Element | null = null;
  if (a.selector) {
    try { target = document.querySelector(a.selector); } catch { /* invalid selector */ }
  }
  if (!target && a.rangeText) {
    const sel = buildFallbackSelector(a.rangeText);
    if (sel) {
      try { target = document.querySelector(sel); } catch { /* ignore */ }
    }
  }
  if (!target) return false;

  // 用 range 高亮 rangeText
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.includes(a.rangeText)) {
      textNodes.push(node as Text);
    }
  }
  if (!textNodes.length) return false;

  for (const tn of textNodes) {
    const idx = tn.textContent!.indexOf(a.rangeText);
    if (idx < 0) continue;
    const range = document.createRange();
    range.setStart(tn, idx);
    range.setEnd(tn, idx + a.rangeText.length);
    // 用 <mark> 包裹
    const mark = document.createElement('mark');
    mark.setAttribute('data-work-browser-annotation-id', a.id);
    mark.setAttribute('data-work-browser-annotation-note', a.note || '');
    mark.setAttribute('data-work-browser-annotation-color', a.color);
    mark.style.background = COLOR_BG[a.color];
    mark.style.borderBottom = `2px solid ${COLOR_BORDER[a.color]}`;
    mark.style.borderRadius = '2px';
    mark.style.cursor = 'pointer';
    mark.style.padding = '0 1px';
    mark.title = a.note || a.rangeText;
    mark.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ipcRenderer.sendToHost('work-browser:annotation-clicked', {
        id: a.id,
        note: a.note,
        rangeText: a.rangeText,
        color: a.color,
        url: location.href,
      });
    });
    try {
      range.surroundContents(mark);
    } catch {
      // range 跨越多个 element 时 surroundContents 失败，放弃这一处
    }
  }
  return true;
}

async function loadAnnotations() {
  if (!location.href || location.href.startsWith('about:')) return;
  try {
    const list = (await ipcRenderer.invoke('work-browser:annotation:list-by-url', location.href)) as AnnotationItem[];
    let hit = 0;
    for (const a of list) {
      try { if (renderAnnotation(a)) hit++; } catch (e) { console.warn('[work-browser] render annotation failed:', e); }
    }
    ipcRenderer.sendToHost('work-browser:annotations-rendered', { total: list.length, hit });
  } catch (e) {
    console.warn('[work-browser] load annotations failed:', e);
  }
}

void main();
