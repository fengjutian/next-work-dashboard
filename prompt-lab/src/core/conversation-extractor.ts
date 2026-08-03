// ── 对话内容提取器 — 纯脚本生成，不依赖 React / Electron ──

/**
 * 构建从 AI 对话页面提取内容的 JavaScript 脚本。
 * 三种策略依次降级：已知选择器 → 启发式检测 → 全文兜底。
 */
export function buildConversationExtractScript(): string {
  return `
    (function() {
      // 策略 1：已知选择器（ChatGPT 等主流站点）
      const knownSelectors = [
        '[data-message-author-role]',
        'article[data-testid^="conversation-turn"]',
      ];
      for (const sel of knownSelectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 1) {
          const lines = [];
          for (const el of nodes) {
            const t = el.textContent?.trim();
            if (!t || t.length < 3) continue;
            const roleNode = el.matches('[data-message-author-role]')
              ? el
              : el.querySelector('[data-message-author-role]');
            const role = roleNode?.getAttribute('data-message-author-role') || '';
            lines.push('### ' + (role === 'user' ? '🧑 用户' : role === 'assistant' ? '🤖 AI' : '内容'));
            lines.push('');
            lines.push(t);
            lines.push('');
          }
          return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'known' });
        }
      }

      // 策略 2：启发式 — 寻找页面中央、可滚动、包含多段文本的容器
      const all = document.body.querySelectorAll('*');
      const vw = window.innerWidth, vh = window.innerHeight;
      let candidates = [];

      for (const el of all) {
        if (el.children.length < 2) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 200) continue;
        if (rect.left > vw * 0.7 || rect.right < vw * 0.3) continue;
        if (rect.top > vh * 0.6) continue;

        const children = Array.from(el.children);
        const textChildren = children.filter(c => {
          const t = c.textContent?.trim() || '';
          return t.length > 15 && c.children.length > 0;
        });

        if (textChildren.length >= 2) {
          candidates.push({
            el: textChildren,
            count: textChildren.length,
            area: rect.width * rect.height,
            centerDist: Math.abs(rect.left + rect.width/2 - vw/2)
          });
        }
      }

      candidates.sort((a, b) => b.count - a.count || a.centerDist - b.centerDist);
      const best = candidates[0];

      if (best && best.count > 1) {
        const lines = ['## 页面提取内容', ''];
        let previousText = '';
        for (const el of best.el) {
          const t = el.textContent?.trim();
          if (!t || t.length < 5) continue;
          if (t === previousText || previousText.includes(t)) continue;
          lines.push(t);
          lines.push('');
          lines.push('---');
          lines.push('');
          previousText = t;
        }
        if (lines.length > 2) {
          return JSON.stringify({ success: true, content: lines.join('\\n'), via: 'auto' });
        }
      }

      // 策略 3：兜底 — 整个页面可见文本
      const bodyText = document.body.innerText?.trim();
      if (bodyText && bodyText.length > 50) {
        return JSON.stringify({ success: true, content: '# 页面内容\\n\\n' + bodyText, via: 'fallback' });
      }

      return JSON.stringify({ success: false });
    })();
  `;
}

// ── 结果类型 ──

export interface ExtractResult {
  success: boolean;
  content?: string;
  via?: string;
}

/**
 * 解析 extract 脚本返回的 JSON 结果
 */
export function parseExtractResult(raw: string): ExtractResult {
  try {
    return JSON.parse(raw) as ExtractResult;
  } catch {
    return { success: false };
  }
}
