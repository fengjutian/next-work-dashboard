import { describe, expect, it } from 'vitest';
import { applyConversationSummary, conversationNeedsSummary, isAbortError, recoverInterruptedRequest } from '../src/plugins/code-editor/ai-conversation';

describe('AI conversation recovery', () => {
  it('detects a conversation over its summary threshold', () => expect(conversationNeedsSummary([{ role: 'user', content: '中'.repeat(5000), timestamp: 1 }], 8000)).toBe(true));
  it('keeps a model summary and recent turns', () => expect(applyConversationSummary(Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: String(index), timestamp: index })), 'decisions')).toHaveLength(5));
  it('marks an in-flight request interrupted after restart', () => expect(recoverInterruptedRequest({ id: '1', instruction: 'fix', startedAt: 1, status: 'running' })).toMatchObject({ status: 'interrupted', instruction: 'fix' }));
  it('recognizes aborted requests', () => expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true));
});
