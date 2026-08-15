import { describe, expect, it } from 'vitest';
import { extractWebsiteMetadata } from '../../src/core/website-registry/metadata';

describe('website metadata extraction', () => {
  it('extracts Open Graph metadata and readable text', () => {
    const result = extractWebsiteMetadata('<html><head><title>Fallback</title><meta property="og:title" content="Example &amp; Docs"><meta name="description" content="Developer documentation"><meta name="keywords" content="docs, api"></head><body><script>secret()</script><main>Build useful things.</main></body></html>', 'https://example.com');
    expect(result.title).toBe('Example & Docs');
    expect(result.description).toBe('Developer documentation');
    expect(result.keywords).toEqual(['docs', 'api']);
    expect(result.textSample).toContain('Build useful things.');
    expect(result.textSample).not.toContain('secret()');
  });
});
