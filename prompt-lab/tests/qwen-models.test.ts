import { describe, expect, it } from 'vitest';
import { QWEN_MODELS } from '../src/plugins/chat/useChatSession';

describe('Qwen platform model catalog', () => {
  it('supports Qwen and DeepSeek models through the same endpoint', () => {
    expect(QWEN_MODELS.map((model) => model.value)).toEqual(expect.arrayContaining([
      'qwen3.7-plus', 'deepseek-v4-pro', 'deepseek-v4-flash',
    ]));
  });
});
