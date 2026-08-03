import { describe, expect, it } from 'vitest';
import { buildConversationExtractScript, parseExtractResult } from '../src/core/conversation-extractor';

describe('conversation extractor', () => {
  it('only assigns roles from explicit role attributes', () => {
    const script = buildConversationExtractScript();
    expect(script).toContain("getAttribute('data-message-author-role')");
    expect(script).not.toContain('const isAI =');
    expect(script).toContain('页面提取内容');
  });

  it('rejects malformed extraction results', () => {
    expect(parseExtractResult('not-json')).toEqual({ success: false });
  });
});
