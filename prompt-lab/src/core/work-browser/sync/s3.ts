import { createHash, createHmac } from 'node:crypto';
import type { SyncAdapter, SyncEntry, SyncFile } from './types';
import { normalizeSyncPath } from './types';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
}

export class S3SyncAdapter implements SyncAdapter {
  readonly kind = 's3' as const;
  constructor(private config: S3Config) {}

  async list(workspaceId: string): Promise<SyncEntry[]> {
    const prefix = `${this.key(workspaceId, '')}/`;
    const entries: SyncEntry[] = [];
    let continuationToken = '';
    do {
      const response = await this.request('GET', '', new Uint8Array(), { 'list-type': '2', prefix, ...(continuationToken ? { 'continuation-token': continuationToken } : {}) });
      const xml = await response.text();
      entries.push(...[...xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<ETag>"?([^<"]+)"?<\/ETag>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)].map((match) => ({
        path: decodeXml(match[1]).slice(prefix.length),
        modifiedAt: Date.parse(match[2]),
        etag: match[3],
        size: Number(match[4]),
      })).filter((entry) => entry.path));
      continuationToken = decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] || '');
    } while (continuationToken);
    return entries;
  }

  async get(workspaceId: string, path: string): Promise<SyncFile> {
    const safe = normalizeSyncPath(path);
    const response = await this.request('GET', this.key(workspaceId, safe), new Uint8Array());
    return { path: safe, data: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag')?.replace(/"/g, '') };
  }

  async put(workspaceId: string, file: SyncFile): Promise<void> {
    await this.request('PUT', this.key(workspaceId, normalizeSyncPath(file.path)), file.data);
  }

  async remove(workspaceId: string, path: string): Promise<void> {
    await this.request('DELETE', this.key(workspaceId, normalizeSyncPath(path)), new Uint8Array());
  }

  private key(workspaceId: string, path: string): string {
    return [this.config.prefix, encodeURIComponent(workspaceId), path].filter(Boolean).join('/').replace(/^\/+/, '');
  }

  private async request(method: string, key: string, body: Uint8Array, query: Record<string, string> = {}): Promise<Response> {
    const endpoint = new URL(this.config.endpoint);
    const canonicalUri = `/${encodeURIComponent(this.config.bucket)}/${key.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`.replace(/\/$/, key ? '' : '/');
    endpoint.pathname = canonicalUri;
    const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    endpoint.search = canonicalQuery;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const tokenHeader = this.config.sessionToken ? `x-amz-security-token:${this.config.sessionToken}\n` : '';
    const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n${tokenHeader}`;
    const signedHeaders = `host;x-amz-content-sha256;x-amz-date${this.config.sessionToken ? ';x-amz-security-token' : ''}`;
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${this.config.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, date), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const response = await fetch(endpoint, {
      method,
      body: method === 'PUT' ? body as BodyInit : undefined,
      headers: {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        ...(this.config.sessionToken ? { 'x-amz-security-token': this.config.sessionToken } : {}),
      },
    });
    if (!response.ok) throw new Error(`S3_HTTP_${response.status}`);
    return response;
  }
}

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function hmac(key: string | Buffer, value: string): Buffer { return createHmac('sha256', key).update(value).digest(); }
function decodeXml(value: string): string { return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
