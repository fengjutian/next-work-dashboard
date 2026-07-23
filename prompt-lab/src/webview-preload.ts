/**
 * next-work-dashboard WebView Preload — Anti-Detection + Network Interception
 * 
 * 在页面 JS 执行前覆盖浏览器指纹，使 webview 看起来更像真实浏览器，
 * 避免 AI 网站检测到 Electron 环境后自动退出登录。
 * 同时 hook fetch() 拦截 AI 对话 API 的请求和响应。
 */
import { ipcRenderer } from 'electron';

// ── 反检测：覆盖浏览器指纹（必须在最顶部，在页面 JS 之前执行）──

// 去掉 webdriver 标记
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
  configurable: true,
  enumerable: true,
});

// 覆盖 plugins —— 真实 Chrome 有多个插件
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    // 返回一个类 PluginArray 对象
    const pluginLike = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    // 给数组加上 PluginArray 特征
    Object.setPrototypeOf(pluginLike, PluginArray.prototype);
    return pluginLike as unknown as PluginArray;
  },
  configurable: true,
  enumerable: true,
});

// 覆盖 languages
Object.defineProperty(navigator, 'languages', {
  get: () => ['zh-CN', 'zh', 'en'],
  configurable: true,
  enumerable: true,
});

// 添加 window.chrome（真实 Chrome 特有）
Object.defineProperty(window, 'chrome', {
  get: () => ({
    runtime: {},
    loadTimes: () => {},
    csi: () => {},
    app: {},
  }),
  configurable: true,
  enumerable: true,
});

// 移除 Electron 暴露的 process 上下文（如果存在）
if ((window as any).process?.type) {
  try { delete (window as any).process; } catch {}
}

// 移除 require（如果存在）
if ((window as any).require) {
  try { delete (window as any).require; } catch {}
}

// ── AI API URL 模式匹配 ──

const API_PATTERNS: { pattern: RegExp; site: string }[] = [
  { pattern: /chat\.deepseek\.com\/api\/v\d+\/chat\/completions/i, site: 'deepseek' },
  { pattern: /chatgpt\.com\/backend-api\/conversation/i,          site: 'chatgpt' },
  { pattern: /kimi\.moonshot\.cn\/api\/chat/i,                    site: 'kimi' },
  { pattern: /tongyi\.aliyun\.com\/api/i,                         site: 'tongyi' },
];

function matchApi(url: string) {
  for (const entry of API_PATTERNS) {
    if (entry.pattern.test(url)) return entry.site;
  }
  return null;
}

// ── SSE 解析 ──

interface CollectedMessage {
  timestamp: number;
  site: string;
  url: string;
  requestBody: unknown;
  responseContent: string;
  role: string; // 'user' | 'assistant'
}

function parseSSEChunk(text: string): string {
  // SSE 单条消息格式: "data: {...}\n\n"
  const lines = text.split('\n');
  let content = '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (jsonStr === '[DONE]') continue;
    try {
      const data = JSON.parse(jsonStr);
      // DeepSeek / OpenAI 兼容格式
      const delta = data?.choices?.[0]?.delta?.content;
      if (delta) content += delta;
    } catch {
      // 非 JSON 行，忽略
    }
  }
  return content;
}

// ── ReadableStream 读取器（用于 SSE 响应）──

async function readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 消息以 \n\n 分隔
    const parts = buffer.split('\n\n');
    // 最后一段可能不完整，留到下次
    buffer = parts.pop() || '';

    for (const part of parts) {
      if (!part.trim()) continue;
      const chunk = parseSSEChunk(part + '\n\n');
      if (chunk) {
        fullContent += chunk;
        onChunk(chunk);
      }
    }
  }

  // 处理剩余 buffer
  if (buffer.trim()) {
    const chunk = parseSSEChunk(buffer);
    if (chunk) fullContent += chunk;
  }

  return fullContent;
}

// ── 发送到宿主页面 ──

function sendToHost(msg: CollectedMessage) {
  try {
    ipcRenderer.sendToHost('conversation-captured', msg);
  } catch {
    // sendToHost 在非 webview preload 环境中会失败，静默忽略
  }
}

// ── Hook fetch ──

const origFetch = window.fetch.bind(window);

window.fetch = async function (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const site = matchApi(url);

  if (!site) {
    return origFetch(input, init);
  }

  // 捕获请求体（用户消息）
  let requestBody: unknown = null;
  if (init?.body) {
    try {
      requestBody = JSON.parse(init.body as string);
    } catch {
      requestBody = init.body;
    }
  }

  const response = await origFetch(input, init);

  // 只处理 SSE/流式响应（AI 的回复）
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') && !contentType.includes('application/json')) {
    return response;
  }

  // 克隆 response 以便读取 body stream
  const cloned = response.clone();
  const body = cloned.body;

  if (!body) return response;

  const reader = body.getReader();
  let fullContent = '';

  // 异步读取流，不阻塞原始 response 返回
  readStream(reader, () => {
    // 增量回调（可用于实时显示），当前版本只发完整消息
  }).then((content) => {
    fullContent = content;
    if (fullContent) {
      sendToHost({
        timestamp: Date.now(),
        site,
        url,
        requestBody,
        responseContent: fullContent,
        role: 'assistant',
      });
    }
  }).catch(() => {
    // 流读取失败，忽略
  });

  return response;
};

// 同时拦截用户侧——在发送请求时记录
// fetch 的 request body 已经在上方捕获，此处不需要额外处理

console.log('[next-work-dashboard] WebView network interceptor active');
