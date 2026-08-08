// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractSvgSource, safeCardFilename, sanitizeGeneratedSvg } from '../src/plugins/hanyu-jinjie/svg';

describe('汉语新解 SVG handling', () => {
  it('extracts SVG from a model code fence', () => {
    expect(extractSvgSource('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')).toBe('<svg viewBox="0 0 1 1"></svg>');
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
    expect(() => sanitizeGeneratedSvg('<div>not svg</div>')).toThrow('有效的 SVG');
    expect(() => sanitizeGeneratedSvg('<svg><text></svg>')).toThrow('有效的 SVG');
  });

  it('creates safe download names', () => expect(safeCardFilename('内卷/赋能:*?')).toBe('内卷_赋能___.svg'));
});
