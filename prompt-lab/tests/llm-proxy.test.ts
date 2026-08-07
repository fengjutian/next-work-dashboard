import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider } from '../src/core/llm';

describe('OpenAI-compatible main-process proxy', () => {
  it('uses the proxy in non-streaming mode and preserves the response', async () => {
    const chatProxy = vi.fn(async () => ({ ok: true, status: 200, data: { choices: [{ message: { content: '千问响应' }, finish_reason: 'stop' }] } }));
    const provider = createOpenAIProvider({ apiKey: '  sk-test  ', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatProxy });
    let output = '';
    for await (const chunk of provider.chat([{ role: 'user', content: '你好' }], { model: 'qwen3.7-plus' })) output += chunk.delta;
    expect(output).toBe('千问响应');
    expect(chatProxy).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-test', body: expect.objectContaining({ stream: false, model: 'qwen3.7-plus' }) }));
  });

  it('surfaces proxy HTTP errors', async () => {
    const provider = createOpenAIProvider({ apiKey: 'key', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatProxy: async () => ({ ok: false, status: 401, error: 'Incorrect API key' }) });
    const consume = async () => { for await (const _chunk of provider.chat([{ role: 'user', content: 'x' }], { model: 'qwen3.7-plus' })) { /* consume */ } };
    await expect(consume()).rejects.toThrow('401');
  });
});
