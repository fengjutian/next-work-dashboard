import { describe, expect, it } from 'vitest';
import { assertSafeRemoteUrl, isSafeWebNavigation } from '@/core/work-browser/security/url-policy';

describe('work-browser URL policy', () => {
  it('allows public http and https URLs', () => {
    expect(assertSafeRemoteUrl('https://example.com/a').hostname).toBe('example.com');
    expect(isSafeWebNavigation('http://example.com')).toBe(true);
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/',
    'file:///etc/passwd',
  ])('blocks unsafe save target %s', (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrow();
  });

  it('blocks executable and local navigation protocols', () => {
    expect(isSafeWebNavigation('javascript:alert(1)')).toBe(false);
    expect(isSafeWebNavigation('file:///tmp/a')).toBe(false);
  });
});
