import { describe, expect, it } from 'vitest';
import { normalizeWebsiteUrl, parseWebsiteCsv, sanitizeWebsiteInput } from '../../src/core/website-registry/validation';

describe('website registry validation', () => {
  it('normalizes ordinary website URLs', () => {
    expect(normalizeWebsiteUrl('Example.COM/')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://Example.COM:443/docs#intro')).toBe('https://example.com/docs');
  });

  it('rejects unsafe protocols and embedded credentials', () => {
    expect(() => normalizeWebsiteUrl('javascript:alert(1)')).toThrow('HTTP');
    expect(() => normalizeWebsiteUrl('https://user:secret@example.com')).toThrow('用户名或密码');
  });

  it('sanitizes names and tags', () => {
    const value = sanitizeWebsiteInput({ name: ' Example ', url: 'example.com', tags: [' docs ', 'docs', ''] });
    expect(value.name).toBe('Example');
    expect(value.tags).toEqual(['docs']);
  });

  it('parses CSV records', () => {
    const rows = parseWebsiteCsv('name,url,tags,favorite\n"Example, Inc",https://example.com,docs|tool,true');
    expect(rows).toEqual([{ name: 'Example, Inc', url: 'https://example.com', description: '', notes: '', tags: ['docs', 'tool'], favorite: true }]);
  });
});
