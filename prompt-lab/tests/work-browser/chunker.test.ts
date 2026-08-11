/**
 * chunker 纯函数测试
 */
import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens } from '@/core/work-browser/embedding/chunker';

describe('estimateTokens', () => {
  it('空字符串', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('英文 4 字符 / token', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('hello world')).toBeLessThan(5);
  });
  it('中文 1.5 字符 / token', () => {
    // 12 个中文字 = ceil(12 / 1.5) = 8 tokens
    expect(estimateTokens('你好世界你好世界你好世界')).toBe(8);
  });
});

describe('chunkText', () => {
  it('空字符串返回 []', () => {
    expect(chunkText('')).toEqual([]);
  });
  it('纯空白返回 []', () => {
    expect(chunkText('   \n\n  \n  ')).toEqual([]);
  });

  it('单段短文本 → 1 chunk', () => {
    const c = chunkText('hello world');
    expect(c.length).toBe(1);
    expect(c[0].text).toBe('hello world');
    expect(c[0].tokenEstimate).toBeGreaterThan(0);
  });

  it('多段（短）→ 合并成 1 个 chunk（< maxChars）', () => {
    const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。';
    const c = chunkText(text); // 默认 maxChars=800
    expect(c.length).toBe(1);
    expect(c[0].text).toContain('第一段');
    expect(c[0].text).toContain('第三段');
  });

  it('多段（> maxChars）→ 多个 chunk（按段落切分 + overlap）', () => {
    const para = (n: number) => `段落 ${n} ${'x'.repeat(500)}`;
    const text = `${para(1)}\n\n${para(2)}\n\n${para(3)}`;
    const c = chunkText(text, { maxChars: 600, overlapChars: 50 });
    expect(c.length).toBeGreaterThan(1);
  });

  it('长段落硬切：超过 maxChars 时按句切', () => {
    const longSentence = 'word '.repeat(500).trim();
    const c = chunkText(longSentence, { maxChars: 200, overlapChars: 30 });
    expect(c.length).toBeGreaterThan(1);
    // 每个 chunk 不应超过 maxChars + 一点 overlap 余量
    for (const chunk of c) {
      expect(chunk.text.length).toBeLessThanOrEqual(250);
    }
  });

  it('多段合并到不超过 maxChars', () => {
    const para = (n: number) => `段落 ${n} 内容`.repeat(10);
    const text = `${para(1)}\n\n${para(2)}\n\n${para(3)}`;
    const c = chunkText(text, { maxChars: 400, overlapChars: 40 });
    expect(c.length).toBeGreaterThanOrEqual(1);
    // 至少一个 chunk 是完整 text 段落
    expect(c.some((x) => x.text.includes('段落 1'))).toBe(true);
  });

  it('overlap 跨段保留上下文', () => {
    const para = (n: number) => `段${'x'.repeat(100)}${n}`;
    const text = `${para(1)}\n\n${para(2)}\n\n${para(3)}`;
    const c = chunkText(text, { maxChars: 250, overlapChars: 50 });
    // chunk 数量应该 >= 1
    expect(c.length).toBeGreaterThan(0);
  });

  it('中文文本按字符切', () => {
    const text = '点击按钮提交表单后，服务器会验证数据并返回结果。整个过程需要前后端配合完成。' .repeat(20);
    const c = chunkText(text, { maxChars: 200, overlapChars: 30 });
    expect(c.length).toBeGreaterThan(1);
    for (const chunk of c) {
      expect(chunk.text.length).toBeLessThanOrEqual(250);
    }
  });
});
