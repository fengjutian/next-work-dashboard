import { afterEach, describe, expect, it, vi } from 'vitest';
import { S3SyncAdapter } from '../../src/core/work-browser/sync/s3';

afterEach(() => vi.unstubAllGlobals());

describe('S3SyncAdapter', () => {
  it('paginates ListObjectsV2 within the exact workspace prefix and signs session tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`
        <ListBucketResult>
          <Contents><Key>root/ws/a.txt</Key><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>"a"</ETag><Size>3</Size></Contents>
          <NextContinuationToken>next&amp;page</NextContinuationToken>
        </ListBucketResult>`))
      .mockResolvedValueOnce(new Response(`
        <ListBucketResult>
          <Contents><Key>root/ws/b.txt</Key><LastModified>2026-01-02T00:00:00Z</LastModified><ETag>"b"</ETag><Size>4</Size></Contents>
        </ListBucketResult>`));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new S3SyncAdapter({
      endpoint: 'https://objects.example.test', region: 'test-1', bucket: 'bucket',
      accessKeyId: 'access', secretAccessKey: 'secret', sessionToken: 'temporary-token', prefix: 'root',
    });
    const entries = await adapter.list('ws');

    expect(entries.map((entry) => entry.path)).toEqual(['a.txt', 'b.txt']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(firstUrl.searchParams.get('prefix')).toBe('root/ws/');
    expect(secondUrl.searchParams.get('continuation-token')).toBe('next&page');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-amz-security-token': 'temporary-token' });
    expect(String(fetchMock.mock.calls[0][1]?.headers.Authorization)).toContain('x-amz-security-token');
  });
});
