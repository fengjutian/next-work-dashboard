import { describe, expect, it } from 'vitest';
import { FRAMEWORK_BY_ID, recommendFrameworks, THINKING_FRAMEWORKS } from '@/plugins/thinking-lab/framework-registry';
import { settleWithConcurrency } from '@/plugins/thinking-lab/analysis-service';
import { buildThinkingReport } from '@/plugins/thinking-lab/report';

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

  it('limits parallel analysis tasks', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 7 }, (_, index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    });
    const results = await settleWithConcurrency(tasks, 3);
    expect(peak).toBe(3);
    expect(results).toHaveLength(7);
    expect(results.every((item) => item.status === 'fulfilled')).toBe(true);
  });

  it('builds a portable Markdown report', () => {
    const report = buildThinkingReport({
      id: 'run-1', question: '是否重构？', context: '团队 5 人', mode: 'deep',
      frameworkIds: ['first-principles'], results: [{ frameworkId: 'first-principles', status: 'done', content: '核心分析' }],
      critique: '存在隐含假设', synthesis: '建议分阶段执行', model: 'test-model', createdAt: 0,
    });
    expect(report).toContain('# 战略分析报告');
    expect(report).toContain('第一性原理');
    expect(report).toContain('存在隐含假设');
    expect(report).toContain('建议分阶段执行');
  });
});
