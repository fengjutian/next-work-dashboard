/**
 * WeRead main-process IPC service.
 *
 * Hosts call `registerWereadIpc({ ipcMain })` once during app startup. All three
 * channels (WeRead Agent gateway + two AI helpers) are self-contained — they only
 * require network access; no host-injected adapter is needed.
 */

import { WEREAD_IPC } from './channels';

export interface WereadIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: any[]) => any): void;
  };
}

const WEREAD_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const WEREAD_SKILL_VERSION = '1.0.4';

async function fetchWereadAgent(apiKey: string, payload: Record<string, unknown>): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!/^wrk-\S{4,}$/.test(apiKey)) return { success: false, error: 'API Key 格式不正确' };
  if (!payload || typeof payload.api_name !== 'string') return { success: false, error: '接口参数不正确' };

  let lastError = '请求微信读书失败';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(WEREAD_GATEWAY, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, skill_version: WEREAD_SKILL_VERSION }),
      });
      const text = await response.text();
      if (!response.ok) {
        let detail = text.trim().slice(0, 300);
        try {
          const body = JSON.parse(text) as { errmsg?: string; message?: string };
          detail = body.errmsg || body.message || detail;
        } catch { /* use response text */ }
        lastError = `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`;
        if ((response.status === 429 || response.status === 499 || response.status >= 500) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
          continue;
        }
        return { success: false, error: lastError };
      }
      let data: Record<string, unknown>;
      try { data = JSON.parse(text) as Record<string, unknown>; }
      catch { return { success: false, error: '微信读书返回了无法解析的数据' }; }
      if (typeof data.errcode === 'number' && data.errcode !== 0) {
        return { success: false, error: String(data.errmsg || `微信读书错误 ${data.errcode}`) };
      }
      if (data.upgrade_info) return { success: false, error: String((data.upgrade_info as { message?: string }).message || '微信读书 Skill 需要升级') };
      return { success: true, data };
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? '请求微信读书超时（60 秒）'
        : error instanceof Error ? error.message : String(error);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
        continue;
      }
    } finally { clearTimeout(timeout); }
  }
  return { success: false, error: lastError };
}

async function fetchOpenAiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature: number; maxTokens: number; timeoutMs: number },
): Promise<{ success: boolean; content?: string; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: options.temperature, max_tokens: options.maxTokens }),
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try { detail = JSON.parse(text).error?.message || detail; } catch { /* use raw */ }
      return { success: false, error: `AI 请求失败（HTTP ${response.status}）：${detail}` };
    }
    if (!text.trim()) return { success: false, error: 'AI 返回了空响应，请重试' };
    let result: { choices?: Array<{ message?: { content?: string } }> };
    try { result = JSON.parse(text) as typeof result; }
    catch { return { success: false, error: `AI 返回非 JSON：${text.slice(0, 80)}` }; }
    const raw = (result.choices?.[0]?.message?.content || '').trim();
    if (!raw) return { success: false, error: 'AI 返回了空内容' };
    return { success: true, content: raw };
  } catch (err) {
    return { success: false, error: err instanceof Error && err.name === 'AbortError' ? 'AI 请求超时' : err instanceof Error ? err.message : String(err) };
  } finally { clearTimeout(timeout); }
}

function stripCodeFences(content: string): string {
  return content.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
}

function extractFirstJsonObject(content: string): string {
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  return first >= 0 && last > first ? content.slice(first, last + 1) : content;
}

function safeJsonParse<T>(content: string): T | null {
  try { return JSON.parse(content) as T; }
  catch { return null; }
}

export function registerWereadIpc(deps: WereadIpcDeps): void {
  const { ipcMain } = deps;

  ipcMain.handle(WEREAD_IPC.REQUEST, async (_event: unknown, apiKey: string, payload: Record<string, unknown>) => {
    return fetchWereadAgent(apiKey, payload);
  });

  ipcMain.handle(WEREAD_IPC.AI_SUMMARY, async (_event: unknown, payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ bookId: string; title: string; author: string; highlights: string[]; reviews: string[] }> }) => {
    const { baseUrl, apiKey, model, books } = payload;
    if (!apiKey || !baseUrl || !model) return { success: false, error: '请先在设置中配置 AI API' };
    if (!books?.length) return { success: false, error: '没有可分析的书籍' };

    const BATCH_SIZE = 3;
    const summaries: Array<{ bookId: string; summary: string; tags: string[] }> = [];

    for (let i = 0; i < books.length; i += BATCH_SIZE) {
      const batch = books.slice(i, i + BATCH_SIZE);
      const booksText = batch.map((book, idx) => {
        const lines = [`${idx + 1}. 《${book.title}》${book.author ? ` — ${book.author}` : ''}`];
        if (book.highlights.length) lines.push(`划线摘录（${book.highlights.length} 条）：${book.highlights.slice(0, 10).join('；')}`);
        if (book.reviews.length) lines.push(`个人想法（${book.reviews.length} 条）：${book.reviews.slice(0, 5).join('；')}`);
        return lines.join('\n');
      }).join('\n\n');

      let lastError = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        lastError = '';
        const response = await fetchOpenAiChat(baseUrl, apiKey, model, [
          { role: 'system', content: '你是一位专业的阅读分析助手。为每本书生成一段简洁的中文摘要（2-4句）和3-5个标签。返回严格的 JSON 格式：{"books":[{"index":1,"summary":"...","tags":["标签1","标签2"]}]}。摘要要抓住书的主题和用户的关注点。标签要简短准确（2-4字）。' },
          { role: 'user', content: booksText },
        ], { temperature: 0.4, maxTokens: 2000, timeoutMs: 120_000 });
        if (!response.success) {
          lastError = response.error || 'AI 请求失败';
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          break;
        }
        const content = extractFirstJsonObject(stripCodeFences(response.content || ''));
        const parsed = safeJsonParse<{ books?: Array<{ index: number; summary: string; tags: string[] }> }>(content);
        if (!parsed) {
          lastError = `AI 返回 JSON 格式异常：${content.slice(0, 80)}`;
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          break;
        }
        const items = parsed.books || (parsed as unknown as Array<{ index: number; summary: string; tags: string[] }>);
        if (!Array.isArray(items)) { lastError = 'AI 返回的 JSON 结构异常（缺少 books 数组）'; break; }
        for (const item of items) {
          const bookIndex = (item.index || 1) - 1;
          if (batch[bookIndex]) {
            summaries.push({ bookId: batch[bookIndex].bookId, summary: item.summary || '', tags: item.tags || [] });
          }
        }
        break;
      }
      if (lastError) return { success: false, error: lastError, summaries };
    }
    return { success: true, summaries };
  });

  ipcMain.handle(WEREAD_IPC.AI_RECOMMEND, async (_event: unknown, payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ title: string; author: string; highlights: string[]; reviews: string[] }> }) => {
    const { baseUrl, apiKey, model, books } = payload;
    if (!apiKey || !baseUrl || !model) return { success: false, error: '请先在设置中配置 AI API' };
    if (!books?.length) return { success: false, error: '没有可分析的书籍' };

    const authors = new Set(books.map((b) => b.author).filter(Boolean));
    const allNotes = books.flatMap((b) => [...b.highlights.slice(0, 8), ...b.reviews.slice(0, 4)]).filter(Boolean);
    const displayBooks = books.length > 60 ? books.slice(0, 60) : books;
    const userText = [
      `我已读的书籍（共 ${books.length} 本，列出前 ${displayBooks.length} 本）：`,
      ...displayBooks.map((b) => `- 《${b.title}》${b.author ? `（${b.author}）` : ''}`),
      '',
      '我的阅读笔记摘要：',
      ...allNotes.slice(0, 20).map((n) => `- ${n}`),
      '',
      `我关注的作者（共 ${authors.size} 位）：${[...authors].slice(0, 30).join('、')}${authors.size > 30 ? ' 等' : ''}`,
      books.length > 60 ? `（另有 ${books.length - 60} 本书未列出）` : '',
    ].join('\n');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchOpenAiChat(baseUrl, apiKey, model, [
        { role: 'system', content: '你是一位专业的阅读推荐顾问。用户提供了完整的阅读历史（所有已读书籍和作者列表），以及部分重点书籍的笔记摘录。请仔细分析用户的阅读品味、关注的主题和偏好的作者，在此基础上推荐值得阅读的书籍。返回严格的 JSON 格式：{"recommendations":[{"type":"same_author","title":"书名","author":"作者","reason":"推荐理由（50字内，具体说明与用户已读书籍或作者的关联）"}]}。type 取值为：same_author（用户已读作者的其他值得读的作品，优先推荐笔记最活跃的作者）、similar（与用户阅读主题高度相近的书籍，可来自不同作者）、opposite（相反视角或对立观点的书籍，帮助用户拓展思维边界）。每类推荐 4-5 本，共 12-15 本。推荐理由要具体、个性化，引用用户实际读过的书或关注的主题。只推荐真实存在的书籍。' },
        { role: 'user', content: userText },
      ], { temperature: 0.7, maxTokens: 6000, timeoutMs: 90_000 });
      if (!response.success) {
        if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        return { success: false, error: response.error };
      }
      const content = extractFirstJsonObject(stripCodeFences(response.content || ''));
      let parsed = safeJsonParse<{ recommendations?: Array<{ type: string; title: string; author: string; reason: string }> }>(content);
      if (!parsed) {
        const repaired = content.replace(/,\s*$/, '').replace(/"\s*$/, '"').replace(/\]\s*$/, ']}'); const fixed = repaired.endsWith('}') ? repaired : repaired + '}';
        parsed = safeJsonParse(fixed);
      }
      if (!parsed) {
        if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        return { success: false, error: `AI 返回格式异常（JSON 可能被截断），请重试。返回内容前 150 字符：${(response.content || '').slice(0, 150)}` };
      }
      return { success: true, recommendations: parsed.recommendations || [] };
    }
    return { success: false, error: 'AI 请求失败' };
  });
}
