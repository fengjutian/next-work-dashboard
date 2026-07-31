import { describe, expect, it } from 'vitest';
import { toBubbleItems } from '../src/components/chat/useChatSession';
import type { Message } from '../src/components/chat/MessageBubble';

describe('多模型回答', () => {
  it('把模型和对比标识传给消息渲染层', () => {
    const messages: Message[] = [{
      id: 'answer-1',
      role: 'assistant',
      content: '模型回答',
      timestamp: 1,
      model: 'deepseek-v4-pro',
      comparisonId: 'comparison-1',
    }];

    const [item] = toBubbleItems(messages, false, null);

    expect(item.extraInfo.model).toBe('deepseek-v4-pro');
    expect(item.extraInfo.comparisonId).toBe('comparison-1');
  });

  it('并行生成时为空的回答保持加载状态', () => {
    const messages: Message[] = [
      {
        id: 'answer-1',
        role: 'assistant',
        content: '已返回',
        timestamp: 1,
        model: 'deepseek-v4-flash',
        comparisonId: 'comparison-1',
      },
      {
        id: 'answer-2',
        role: 'assistant',
        content: '',
        timestamp: 1,
        model: 'deepseek-v4-pro',
        comparisonId: 'comparison-1',
      },
    ];

    const items = toBubbleItems(messages, true, null);

    expect(items[1].status).toBe('loading');
  });
});
