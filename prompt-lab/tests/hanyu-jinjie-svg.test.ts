// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractExplanation, extractSvgSource, safeCardFilename, sanitizeGeneratedSvg } from '../src/plugins/hanyu-jinjie/svg';

describe('汉语新解 SVG handling', () => {
  it('extracts SVG from a model code fence', () => {
    expect(extractSvgSource('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')).toBe('<svg viewBox="0 0 1 1"></svg>');
  });

  it('extracts a complete SVG when the model adds prose around it', () => {
    expect(extractSvgSource('说吧。\n```svg\n<svg><text>内卷</text></svg>\n```\n生成完成')).toBe('<svg><text>内卷</text></svg>');
  });

  it('removes executable content and external resources', () => {
    const result = sanitizeGeneratedSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(1)</script><foreignObject><div>bad</div></foreignObject>
      <image href="https://evil.example/image.png"/><a href="javascript:alert(1)"><text>安全文本</text></a>
      <rect onclick="alert(1)" style="fill:url(https://evil.example/a)"/>
    </svg>`);
    expect(result).not.toMatch(/script|foreignObject|onload|onclick|javascript:|evil\.example/i);
    expect(result).toContain('安全文本');
    expect(result).toContain('role="img"');
  });

  it('rejects malformed or non-SVG responses', () => {
    expect(() => sanitizeGeneratedSvg('<div>not svg</div>')).toThrow('没有找到 SVG');
    expect(() => sanitizeGeneratedSvg('<svg><text></svg>')).toThrow('有效的 SVG');
  });

  it('extracts and limits the detailed explanation', () => {
    expect(extractExplanation('<svg></svg><explanation>  权力的包装术。 </explanation>')).toBe('权力的包装术。');
    expect(extractExplanation(`<explanation>${'刺'.repeat(301)}</explanation>`)).toHaveLength(300);
  });

  it('creates safe PNG download names', () => expect(safeCardFilename('内卷/赋能:*?')).toBe('内卷_赋能___.png'));
});
