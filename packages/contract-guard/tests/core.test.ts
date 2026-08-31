import { describe, expect, it } from 'vitest';
import { analyzeContract, extractClauses } from '../src/core';

describe('contract guard core', () => {
  it('extracts clauses with stable offsets', () => {
    const clauses = extractClauses('第一条 服务\n提供系统。\n第二条 责任\n乙方承担一切损失。');
    expect(clauses).toHaveLength(2); expect(clauses[1].section).toBe('第二条');
    expect(clauses[1].content).toContain('一切损失');
  });
  it('links risk evidence to its clause', () => {
    const result = analyzeContract('test.txt', '第1条 责任\n乙方承担任何损失，且本合同期满自动续期一年。', '乙方');
    expect(result.risks.map(r => r.category)).toEqual(expect.arrayContaining(['liability', 'renewal']));
    expect(result.clauses.some(c => c.id === result.risks[0].clauseId)).toBe(true);
    expect(result.healthScore).toBeLessThan(100);
  });
});
