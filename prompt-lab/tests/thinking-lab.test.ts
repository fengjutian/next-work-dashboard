import { describe, expect, it } from 'vitest';
import { FRAMEWORK_BY_ID, recommendFrameworks, THINKING_FRAMEWORKS } from '@/plugins/thinking-lab/framework-registry';

describe('thinking-lab framework registry', () => {
  it('contains unique, complete framework definitions', () => {
    expect(THINKING_FRAMEWORKS).toHaveLength(13);
    expect(new Set(THINKING_FRAMEWORKS.map((item) => item.id)).size).toBe(13);
    for (const item of THINKING_FRAMEWORKS) {
      expect(item.name).toBeTruthy();
      expect(item.prompt.length).toBeGreaterThan(20);
      expect(FRAMEWORK_BY_ID.get(item.id)).toBe(item);
    }
  });

  it('recommends diagnostic frameworks for an outage', () => {
    const ids = recommendFrameworks('生产服务器宕机，如何排查根因？');
    expect(ids).toEqual(expect.arrayContaining(['occam', 'bayesian', 'inversion']));
  });

  it('recommends strategic frameworks for a technical architecture decision', () => {
    const ids = recommendFrameworks('我们应该如何重构现有技术架构？');
    expect(ids).toEqual(expect.arrayContaining(['first-principles', 'systems', 'red-team']));
    expect(ids).toHaveLength(4);
  });

  it('falls back to a balanced combination', () => {
    expect(recommendFrameworks('帮我分析这个问题')).toEqual([
      'first-principles', 'systems', 'red-team', 'decision-tree',
    ]);
  });
});
