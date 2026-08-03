import { describe, expect, it } from 'vitest';
import { buildConversationExtractScript, parseExtractResult } from '../src/core/conversation-extractor';

describe('conversation extractor', () => {
  it('only assigns roles from explicit role attributes', () => {
    const script = buildConversationExtractScript();
    expect(script).toContain("getAttribute('data-message-author-role')");
    expect(script).not.toContain('const isAI =');
    expect(script).toContain("via: 'full-page'");
    expect(script).toContain('nextWorkLastPrompt');
    expect(script).toContain('next-work-last-prompt');
    expect(script).not.toContain("lines.push('---')");
  });

  it('rejects malformed extraction results', () => {
    expect(parseExtractResult('not-json')).toEqual({ success: false });
  });

  it('passes an application-captured prompt into the extraction script', () => {
    const script = buildConversationExtractScript('UUID 碰撞概率？');
    expect(script).toContain(JSON.stringify(['UUID 碰撞概率？']));
    expect(script).toContain('submittedPrompt =');
  });

  it('supports exporting multiple captured conversation turns', () => {
    const script = buildConversationExtractScript(['问题一', '问题二']);
    expect(script).toContain(JSON.stringify(['问题一', '问题二']));
    expect(script).toContain("via: 'paired'");
  });
});
