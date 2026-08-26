import { describe, expect, it } from 'vitest';
import { clearWereadAnalysisCache, extractWereadWords, tfIdfWereadTerms } from '../src/core/analysis';

describe('WeRead shared analysis', () => {
  it('filters stop words and reuses deterministic tokenization', () => {
    clearWereadAnalysisCache();
    const first = extractWereadWords('这个 数据模型 数据模型');
    expect(first).not.toContain('这个');
    expect(first.join('')).toContain('数据模型');
    expect(extractWereadWords('这个 数据模型 数据模型')).toEqual(first);
  });

  it('uses inverse document frequency to favor distinctive terms', () => {
    const scores = tfIdfWereadTerms([
      { id: 'a', text: '通用 主题 独特 独特' },
      { id: 'b', text: '通用 主题 阅读 方法' },
    ]);
    expect(scores.get('独特')).toBeGreaterThan(scores.get('通用') || 0);
  });
});
