import type { SyncAdapter, SyncEntry, SyncFile } from './types';
import { normalizeSyncPath } from './types';

export interface WebDavConfig {
  baseUrl: string;
  username?: string;
  password?: string;
}

export class WebDavSyncAdapter implements SyncAdapter {
  readonly kind = 'webdav' as const;
  constructor(private config: WebDavConfig) {}

  async list(workspaceId: string): Promise<SyncEntry[]> {
    const response = await this.request(`${encodeURIComponent(workspaceId)}/`, { method: 'PROPFIND', headers: { Depth: 'infinity' } });
    const xml = await response.text();
    const root = new URL(`${encodeURIComponent(workspaceId)}/`, ensureSlash(this.config.baseUrl)).pathname;
    return [...xml.matchAll(/<[^:>]*:?response[\s\S]*?<[^:>]*:?href>([^<]+)<\/[^:>]*:?href>[\s\S]*?<[^:>]*:?getcontentlength>(\d+)<\/[^:>]*:?getcontentlength>[\s\S]*?<\/[^:>]*:?response>/gi)]
      .map((match) => ({ path: decodeURIComponent(match[1]).replace(root, '').replace(/^\/+/, ''), size: Number(match[2]) }))
      .filter((entry) => entry.path);
  }

  async get(workspaceId: string, path: string): Promise<SyncFile> {
    const safe = normalizeSyncPath(path);
    const response = await this.request(`${encodeURIComponent(workspaceId)}/${encodePath(safe)}`);
    return { path: safe, data: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag') || undefined };
  }

  async put(workspaceId: string, file: SyncFile): Promise<void> {
    const safe = normalizeSyncPath(file.path);
    await this.ensureCollections(workspaceId, safe);
    await this.request(`${encodeURIComponent(workspaceId)}/${encodePath(safe)}`, { method: 'PUT', body: file.data as BodyInit });
  }

  async remove(workspaceId: string, path: string): Promise<void> {
    await this.request(`${encodeURIComponent(workspaceId)}/${encodePath(normalizeSyncPath(path))}`, { method: 'DELETE' });
  }

  private async ensureCollections(workspaceId: string, path: string): Promise<void> {
    const segments = [encodeURIComponent(workspaceId), ...path.split('/').slice(0, -1).map(encodeURIComponent)];
    for (let index = 1; index <= segments.length; index += 1) {
      const response = await this.request(`${segments.slice(0, index).join('/')}/`, { method: 'MKCOL' }, true);
      if (!response.ok && response.status !== 405) throw new Error(`WEBDAV_MKCOL_FAILED:${response.status}`);
    }
  }

  private async request(relative: string, init: RequestInit = {}, allowFailure = false): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.config.username) headers.set('Authorization', `Basic ${base64(`${this.config.username}:${this.config.password || ''}`)}`);
    const response = await fetch(new URL(relative, ensureSlash(this.config.baseUrl)), { ...init, headers });
    if (!allowFailure && !response.ok) throw new Error(`WEBDAV_HTTP_${response.status}`);
    return response;
  }
}

function ensureSlash(value: string): string { return value.endsWith('/') ? value : `${value}/`; }
function encodePath(value: string): string { return value.split('/').map(encodeURIComponent).join('/'); }
function base64(value: string): string { return typeof Buffer === 'undefined' ? btoa(value) : Buffer.from(value).toString('base64'); }
