import type { ApiDebugRequest, ApiDebugResponse } from '../../core/code-visualizer';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const SENSITIVE_HEADERS = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;

export async function executeApiDebugRequest(input: ApiDebugRequest): Promise<ApiDebugResponse> {
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('调试台仅支持 HTTP/HTTPS');
  if (url.username || url.password) throw new Error('请勿在 URL 中嵌入凭据，请使用请求头');
  const timeoutMs = Math.min(30_000, Math.max(500, input.timeoutMs ?? 10_000));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: input.method, headers: input.headers, body: ['GET', 'HEAD'].includes(input.method) ? undefined : input.body, redirect: 'follow', signal: controller.signal });
    const buffer = new Uint8Array(await response.arrayBuffer()); const truncated = buffer.byteLength > MAX_RESPONSE_BYTES;
    const body = new TextDecoder().decode(buffer.slice(0, MAX_RESPONSE_BYTES));
    const headers: Record<string, string> = {}; response.headers.forEach((value, key) => { headers[key] = SENSITIVE_HEADERS.test(key) ? '[已隐藏]' : value; });
    return { status: response.status, statusText: response.statusText, durationMs: Date.now() - startedAt, headers, body, truncated };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`请求在 ${timeoutMs} ms 后超时`);
    throw error;
  } finally { clearTimeout(timer); }
}
