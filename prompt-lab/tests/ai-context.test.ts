import { describe, expect, it } from 'vitest';
import { estimateTokens, fitContextToTokenBudget } from '../src/plugins/code-editor/agents/ai-context';

describe('AI context budgeting', () => {
  it('estimates CJK more densely than ASCII', () => {
    expect(estimateTokens('中文测试')).toBe(4);
    expect(estimateTokens('test')).toBeLessThan(4);
  });

  it('keeps high-priority files and reports omitted context', () => {
    const result = fitContextToTokenBudget([
      { path: 'low.ts', content: 'x'.repeat(20_000) },
      { path: 'active.ts', content: 'y'.repeat(2_000), priority: 100 },
    ], 5_000, 1_000);
    expect(result.files[0].path).toBe('active.ts');
    expect(result.omitted).toContain('low.ts');
    expect(result.estimatedTokens).toBeLessThanOrEqual(5_000);
  });

  it('compresses the first oversized file instead of sending an empty context', () => {
    const result = fitContextToTokenBudget([{ path: 'large.ts', content: 'a'.repeat(100_000) }], 5_000, 1_000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain('Token 预算压缩');
  });
});
