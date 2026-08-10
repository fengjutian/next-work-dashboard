import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_PLUGIN_PACKAGE_SIZE = 2 * 1024 * 1024;
const CATALOG_MAX_SIZE = 512 * 1024;

export interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  downloadUrl: string;
  sha256: string;
  size?: number;
}

export interface MarketplaceCatalog {
  schemaVersion: 1;
  plugins: MarketplacePlugin[];
  fetchedAt?: number;
}

const root = () => path.join(app.getPath('userData'), 'plugins');
const definitionsPath = () => path.join(root(), 'definitions.json');
const catalogPath = () => path.join(root(), 'marketplace-catalog.json');

async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath).catch(async (renameError) => {
      await fs.rm(temporary, { force: true });
      throw renameError;
    });
    if (error instanceof Error && !filePath) throw error;
  }
}

function safeId(id: string): string {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$/u.test(id)) throw new Error('INVALID_PLUGIN_ID');
  return id;
}

function safeVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('INVALID_PLUGIN_VERSION');
  return version;
}

function parseCatalog(value: unknown): MarketplaceCatalog {
  const catalog = value as MarketplaceCatalog;
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) throw new Error('INVALID_MARKETPLACE_CATALOG');
  for (const item of catalog.plugins) {
    safeId(item.id);
    safeVersion(item.version);
    if (!item.name || !item.downloadUrl || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
      throw new Error(`INVALID_MARKETPLACE_ENTRY:${item.id || 'unknown'}`);
    }
  }
  return catalog;
}

export async function loadPluginDefinitions(): Promise<unknown[]> {
  try {
    const value = JSON.parse(await fs.readFile(definitionsPath(), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function savePluginDefinitions(definitions: unknown[]): Promise<void> {
  await atomicWrite(definitionsPath(), `${JSON.stringify(definitions, null, 2)}\n`);
}

export async function loadCachedCatalog(): Promise<MarketplaceCatalog | null> {
  try {
    return parseCatalog(JSON.parse(await fs.readFile(catalogPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function fetchMarketplaceCatalog(url: string): Promise<MarketplaceCatalog> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('MARKETPLACE_URL_MUST_USE_HTTPS');
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`MARKETPLACE_HTTP_${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > CATALOG_MAX_SIZE) throw new Error('MARKETPLACE_CATALOG_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text) > CATALOG_MAX_SIZE) throw new Error('MARKETPLACE_CATALOG_TOO_LARGE');
  const catalog = { ...parseCatalog(JSON.parse(text)), fetchedAt: Date.now() };
  await atomicWrite(catalogPath(), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

export async function installMarketplacePlugin(entry: MarketplacePlugin): Promise<{ path: string; sha256: string; bundle: string }> {
  safeId(entry.id);
  safeVersion(entry.version);
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) throw new Error('INVALID_PLUGIN_SHA256');
  const response = await fetchMarketplaceBytes(entry.downloadUrl);
  if (response.length > MAX_PLUGIN_PACKAGE_SIZE || (entry.size && response.length !== entry.size)) throw new Error('PLUGIN_PACKAGE_SIZE_INVALID');
  const digest = crypto.createHash('sha256').update(response).digest('hex');
  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error('PLUGIN_SHA256_MISMATCH');
  const installPath = path.join(root(), 'installed', entry.id, entry.version, `${entry.id}.nwd`);
  await atomicWrite(installPath, response);
  return { path: installPath, sha256: digest, bundle: response.toString('utf8') };
}

async function fetchMarketplaceBytes(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('PLUGIN_URL_MUST_USE_HTTPS');
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`PLUGIN_HTTP_${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_PLUGIN_PACKAGE_SIZE) throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
  if (!response.body) throw new Error('PLUGIN_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) { finished = true; continue; }
    total += value.byteLength;
    if (total > MAX_PLUGIN_PACKAGE_SIZE) {
      await reader.cancel();
      throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
