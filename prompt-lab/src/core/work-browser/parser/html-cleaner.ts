/**
 * HTML Cleaner — 净化规则
 *
 * 设计目标：去广告 / 弹窗 / Cookie Banner / 跟踪器 / 侧边栏 / 自动播放。
 * 规则按"黑名单 + 自定义选择器 + 内容启发式"三层叠加。
 *
 * 注意：DOM 净化最终发生在 webview preload 注入的脚本里（render 端）。
 * 本文件输出的 CSS/JS 注入片段会被 work-browser 的 main 端生成并下发。
 *
 * 不做"完整 Readability 风格提取"——那是 readability.ts 的职责。
 */
import type { CleanOptions } from './types';

interface CleanerArtifacts {
  css: string;
  js: string;
  blockedDomains: string[];
  blockedSelectors: string[];
}

/** 内置弹窗/Cookie/广告通用选择器。来源：EasyList 风格通用模式。 */
const COOKIE_BANNER_SELECTORS = [
  '#cookie-banner', '#cookie-notice', '#cookie-consent', '#cookie-law-info-bar',
  '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-bar', '.cookie-alert',
  '[aria-label*="cookie" i]', '[aria-label*="Cookie" i]',
  '[class*="gdpr" i]', '[id*="gdpr" i]',
  '[class*="consent" i][class*="banner" i]',
  '#CybotCookiebotDialog', '#onetrust-banner-sdk', '#truste-consent-track', '#hs-eu-cookie-confirmation',
];

const POPUP_SELECTORS = [
  '.modal', '.overlay', '.popup', '.lightbox',
  '[class*="modal" i]', '[class*="popup" i]', '[class*="overlay" i]',
  '[class*="newsletter" i]', '[class*="subscribe" i][class*="modal" i]',
  '[role="dialog"][aria-modal="true"]',
];

const AD_SELECTORS = [
  '.ad', '.ads', '.advert', '.advertisement',
  '[class*="-ad-"]', '[class*=" ads " i]', '[class^="ad-"]', '[class$="-ad"]',
  'ins.adsbygoogle', '#taboola', '#outbrain', '.taboola', '.outbrain',
  '[id*="google_ads" i]', '[id*="ad-slot" i]', '[id^="ad-"]',
];

const SIDEBAR_SELECTORS = [
  '.sidebar', '#sidebar', 'aside.sidebar', 'aside#sidebar',
  '[class*="sidebar" i]', '[role="complementary"]',
];

const TRACKER_SELECTORS = [
  'iframe[src*="doubleclick"]', 'iframe[src*="googletagmanager"]', 'iframe[src*="facebook.com/plugins"]',
  'script[src*="google-analytics"]', 'script[src*="googletagmanager"]', 'script[src*="hotjar"]',
  'script[src*="facebook.net"]', 'script[src*="mixpanel"]', 'script[src*="segment.com"]',
];

const TRACKER_DOMAINS = [
  'doubleclick.net', 'googletagmanager.com', 'googlesyndication.com',
  'google-analytics.com', 'hotjar.com', 'mixpanel.com', 'segment.com', 'segment.io',
  'facebook.net', 'connect.facebook.net', 'mc.yandex.ru', 'baidu.com/hp.gif',
  'hm.baidu.com', 'cnzz.com', 'umeng.com', 'adnxs.com', 'criteo.com', 'taboola.com', 'outbrain.com',
];

export function htmlClean(opts: CleanOptions): CleanerArtifacts {
  const blockedSelectors: string[] = [];

  if (opts.removeCookieBanner) blockedSelectors.push(...COOKIE_BANNER_SELECTORS);
  if (opts.removePopups) blockedSelectors.push(...POPUP_SELECTORS);
  if (opts.removeAds) blockedSelectors.push(...AD_SELECTORS);
  if (opts.removeSidebar) blockedSelectors.push(...SIDEBAR_SELECTORS);
  if (opts.removeTrackers) blockedSelectors.push(...TRACKER_SELECTORS);
  if (opts.customSelectors.length) blockedSelectors.push(...opts.customSelectors);

  // CSS 注入：display:none + position:fixed !important 配合 JS 主动 remove
  const css = `
/* work-browser · cleaner */
${blockedSelectors.map((s) => `${s} { display: none !important; visibility: hidden !important; }`).join('\n')}
${opts.blockMediaAutoplay ? 'video, audio { autoplay: off !important; } video[autoplay], audio[autoplay] { pause: 1; }' : ''}
html, body { scroll-behavior: auto !important; }
`.trim();

  // JS 注入：在 webview 加载完成后兜底移除（防 CSS 漏过）
  const js = `
(function(){
  if (window.__workBrowserCleaner) return;
  window.__workBrowserCleaner = true;
  const SELECTORS = ${JSON.stringify(blockedSelectors)};
  const remove = () => {
    SELECTORS.forEach(function(sel){
      try {
        var nodes = document.querySelectorAll(sel);
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n && n.parentNode) n.parentNode.removeChild(n);
        }
      } catch (_) {}
    });
  };
  remove();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', remove, { once: true });
  }
  // 防 SPA 重新插入
  var observer = new MutationObserver(function(){ remove(); });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', function(){ observer.observe(document.body, { childList: true, subtree: true }); }, { once: true });
  ${opts.blockMediaAutoplay ? `
  var pauseMedia = function(){
    document.querySelectorAll('video[autoplay], audio[autoplay]').forEach(function(m){ try { m.pause(); m.removeAttribute('autoplay'); } catch(_){} });
  };
  pauseMedia();
  document.addEventListener('play', function(e){ e.target.pause(); }, true);
  ` : ''}
})();
`.trim();

  return {
    css,
    js,
    blockedDomains: [...new Set([...TRACKER_DOMAINS, ...opts.blockDomains])],
    blockedSelectors,
  };
}
