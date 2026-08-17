import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { InstalledPluginState, InstalledPluginVersion, MarketplaceCatalog, MarketplacePlugin, PluginArtifact, PluginInstallRequest, PluginPackageManifest } from '../core/plugin-platform/types';

export type { MarketplaceCatalog, MarketplacePlugin } from '../core/plugin-platform/types';
export const MAX_PLUGIN_PACKAGE_SIZE = 512 * 1024 * 1024;
export const MAX_PLUGIN_EXTRACTED_SIZE = 1024 * 1024 * 1024;
export const MAX_PLUGIN_FILE_COUNT = 10_000;
const CATALOG_MAX_SIZE = 512 * 1024;
const SUPPORTED_PLUGIN_API_VERSION = 1;

const root = () => path.join(app.getPath('userData'), 'plugins');
const definitionsPath = () => path.join(root(), 'definitions.json');
const catalogPath = () => path.join(root(), 'marketplace-catalog.json');
const packageRoot = (id: string) => path.join(root(), 'packages', id);
const statePath = (id: string) => path.join(packageRoot(id), 'state.json');
const versionPath = (id: string, version: string) => path.join(packageRoot(id), 'versions', version);

async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  try { await fs.rename(temporary, filePath); }
  catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath).catch(async (error) => { await fs.rm(temporary, { force: true }); throw error; });
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

export function validatePluginArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('PLUGIN_ARCHIVE_UNSAFE_PATH');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) throw new Error('PLUGIN_ARCHIVE_UNSAFE_PATH');
  return segments.join('/');
}

function validateArtifact(artifact: PluginArtifact): void {
  if (!artifact.url || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error('INVALID_PLUGIN_ARTIFACT');
  if ((artifact.signature && !artifact.publicKey) || (!artifact.signature && artifact.publicKey)) throw new Error('INVALID_PLUGIN_SIGNATURE_METADATA');
}

function parseCatalog(value: unknown): MarketplaceCatalog {
  const catalog = value as MarketplaceCatalog;
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) throw new Error('INVALID_MARKETPLACE_CATALOG');
  for (const item of catalog.plugins) {
    safeId(item.id);
    if (!item.name) throw new Error(`INVALID_MARKETPLACE_ENTRY:${item.id}`);
    if (item.versions?.length) {
      for (const release of item.versions) {
        safeVersion(release.version);
        for (const artifact of Object.values(release.artifacts ?? {})) validateArtifact(artifact);
      }
    } else {
      if (!item.version || !item.downloadUrl || !item.sha256) throw new Error(`INVALID_MARKETPLACE_ENTRY:${item.id}`);
      safeVersion(item.version);
      validateArtifact({ url: item.downloadUrl, sha256: item.sha256, size: item.size });
    }
  }
  return catalog;
}

function parseManifest(value: unknown, expectedId: string, expectedVersion: string): PluginPackageManifest {
  const manifest = value as PluginPackageManifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.id !== expectedId || manifest.version !== expectedVersion) throw new Error('PLUGIN_MANIFEST_MISMATCH');
  safeId(manifest.id); safeVersion(manifest.version);
  if (!manifest.name || !Number.isInteger(manifest.pluginApiVersion) || manifest.pluginApiVersion < 1) throw new Error('INVALID_PLUGIN_MANIFEST');
  if (manifest.pluginApiVersion > SUPPORTED_PLUGIN_API_VERSION) throw new Error('PLUGIN_API_VERSION_UNSUPPORTED');
  if (manifest.engines?.app && !satisfiesVersion(app.getVersion(), manifest.engines.app)) throw new Error('PLUGIN_APP_VERSION_INCOMPATIBLE');
  for (const entrypoint of Object.values(manifest.entrypoints ?? {})) validatePluginArchivePath(entrypoint);
  return manifest;
}

function versionParts(value: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error('INVALID_SEMVER');
  return match.slice(1).map(Number);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left); const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function satisfiesVersion(version: string, range: string): boolean {
  return range.trim().split(/\s+/).every((constraint) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(constraint);
    if (!match) return false;
    const operator = match[1] ?? '='; const expected = match[2]; const compared = compareVersions(version, expected);
    if (operator === '>=') return compared >= 0;
    if (operator === '<=') return compared <= 0;
    if (operator === '>') return compared > 0;
    if (operator === '<') return compared < 0;
    if (operator === '^') return compared >= 0 && versionParts(version)[0] === versionParts(expected)[0];
    if (operator === '~') { const current = versionParts(version); const target = versionParts(expected); return compared >= 0 && current[0] === target[0] && current[1] === target[1]; }
    return compared === 0;
  });
}

async function loadState(id: string): Promise<InstalledPluginState> {
  safeId(id);
  try {
    const state = JSON.parse(await fs.readFile(statePath(id), 'utf8')) as InstalledPluginState;
    return { ...state, id };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { id, enabled: false, activeVersion: null, previousVersion: null, installedVersions: [], channel: 'stable', updatedAt: 0 };
  }
}

async function saveState(state: InstalledPluginState): Promise<void> {
  await atomicWrite(statePath(state.id), `${JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2)}\n`);
}

function verifySignature(bytes: Buffer, artifact: PluginArtifact): void {
  if (!artifact.signature || !artifact.publicKey) return;
  if (!crypto.verify(null, bytes, artifact.publicKey, Buffer.from(artifact.signature, 'base64'))) throw new Error('PLUGIN_SIGNATURE_INVALID');
}

async function extractPackage(bytes: Buffer, destination: string): Promise<void> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(archive.files);
  if (entries.length > MAX_PLUGIN_FILE_COUNT) throw new Error('PLUGIN_ARCHIVE_TOO_MANY_FILES');
  let extractedSize = 0;
  for (const entry of entries) {
    const relative = validatePluginArchivePath(entry.name);
    if (entry.dir) continue;
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error('PLUGIN_ARCHIVE_SYMLINK_NOT_ALLOWED');
    const data = await entry.async('nodebuffer');
    extractedSize += data.length;
    if (extractedSize > MAX_PLUGIN_EXTRACTED_SIZE) throw new Error('PLUGIN_ARCHIVE_EXPANDED_TOO_LARGE');
    const target = path.join(destination, relative);
    const base = path.resolve(destination);
    const resolved = path.resolve(target);
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error('PLUGIN_ARCHIVE_UNSAFE_PATH');
    await fs.mkdir(path.dirname(target), { recursive: true });
    const mode = unixMode & 0o777;
    await fs.writeFile(target, data, mode ? { mode } : undefined);
  }
}

export async function loadPluginDefinitions(): Promise<unknown[]> {
  try { const value = JSON.parse(await fs.readFile(definitionsPath(), 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function savePluginDefinitions(definitions: unknown[]): Promise<void> {
  await atomicWrite(definitionsPath(), `${JSON.stringify(definitions, null, 2)}\n`);
}

export async function loadCachedCatalog(): Promise<MarketplaceCatalog | null> {
  try { return parseCatalog(JSON.parse(await fs.readFile(catalogPath(), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function fetchMarketplaceCatalog(url: string): Promise<MarketplaceCatalog> {
  const bytes = await fetchMarketplaceBytes(url, CATALOG_MAX_SIZE, 'MARKETPLACE');
  const catalog = { ...parseCatalog(JSON.parse(bytes.toString('utf8'))), fetchedAt: Date.now() };
  await atomicWrite(catalogPath(), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

export async function installPluginPackage(request: PluginInstallRequest): Promise<InstalledPluginVersion> {
  const id = safeId(request.pluginId);
  const version = safeVersion(request.version);
  validateArtifact(request.artifact);
  try { await fs.access(destinationFor(id, version)); throw new Error('PLUGIN_VERSION_ALREADY_INSTALLED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bytes = await fetchMarketplaceBytes(request.artifact.url, MAX_PLUGIN_PACKAGE_SIZE, 'PLUGIN');
  if (request.artifact.size && bytes.length !== request.artifact.size) throw new Error('PLUGIN_PACKAGE_SIZE_INVALID');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest.toLowerCase() !== request.artifact.sha256.toLowerCase()) throw new Error('PLUGIN_SHA256_MISMATCH');
  verifySignature(bytes, request.artifact);

  const staging = path.join(root(), 'staging', `${id}-${version}-${crypto.randomUUID()}`);
  const destination = destinationFor(id, version);
  await fs.mkdir(staging, { recursive: true });
  try {
    await extractPackage(bytes, staging);
    const manifest = parseManifest(JSON.parse(await fs.readFile(path.join(staging, 'plugin.json'), 'utf8')), id, version);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(staging, destination);
    const state = await loadState(id);
    if (!state.installedVersions.includes(version)) state.installedVersions.push(version);
    if (request.activate !== false) {
      state.previousVersion = state.activeVersion && state.activeVersion !== version ? state.activeVersion : state.previousVersion;
      state.activeVersion = version;
      state.enabled = true;
    }
    await saveState(state);
    return { manifest, path: destination, active: state.activeVersion === version };
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

export async function installCatalogPlugin(pluginId: string, version: string, activate = true): Promise<InstalledPluginVersion> {
  const catalog = await loadCachedCatalog();
  const plugin = catalog?.plugins.find((item) => item.id === pluginId);
  const release = plugin?.versions?.find((item) => item.version === version);
  if (!plugin || !release) throw new Error('PLUGIN_RELEASE_NOT_FOUND');
  const artifact = release.artifacts[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error('PLUGIN_PLATFORM_NOT_SUPPORTED');
  return installPluginPackage({ pluginId, version, artifact, activate });
}

export async function listInstalledPlugins(): Promise<InstalledPluginState[]> {
  try {
    const entries = await fs.readdir(path.join(root(), 'packages'), { withFileTypes: true });
    return Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => loadState(entry.name)));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function activatePluginVersion(id: string, version: string): Promise<InstalledPluginState> {
  safeId(id); safeVersion(version);
  await fs.access(path.join(versionPath(id, version), 'plugin.json'));
  const state = await loadState(id);
  state.previousVersion = state.activeVersion && state.activeVersion !== version ? state.activeVersion : state.previousVersion;
  state.activeVersion = version; state.enabled = true;
  if (!state.installedVersions.includes(version)) state.installedVersions.push(version);
  await saveState(state); return state;
}

export async function rollbackPlugin(id: string): Promise<InstalledPluginState> {
  const state = await loadState(safeId(id));
  if (!state.previousVersion) throw new Error('PLUGIN_ROLLBACK_VERSION_MISSING');
  const previous = state.previousVersion;
  await fs.access(path.join(versionPath(id, previous), 'plugin.json'));
  state.previousVersion = state.activeVersion; state.activeVersion = previous; state.enabled = true;
  await saveState(state); return state;
}

export async function uninstallPluginVersion(id: string, version: string): Promise<InstalledPluginState> {
  safeId(id); safeVersion(version);
  const state = await loadState(id);
  if (state.activeVersion === version) throw new Error('PLUGIN_ACTIVE_VERSION_CANNOT_BE_REMOVED');
  await fs.rm(versionPath(id, version), { recursive: true, force: true });
  state.installedVersions = state.installedVersions.filter((item) => item !== version);
  if (state.previousVersion === version) state.previousVersion = null;
  await saveState(state); return state;
}

export async function resolveActivePluginPath(id: string, relativePath = ''): Promise<string | null> {
  const state = await loadState(safeId(id));
  if (!state.enabled || !state.activeVersion) return null;
  const target = path.join(versionPath(id, state.activeVersion), relativePath ? validatePluginArchivePath(relativePath) : '');
  try { await fs.access(target); return target; } catch { return null; }
}

export function resolveActivePluginPathSync(id: string, relativePath = ''): string | null {
  safeId(id);
  try {
    const state = JSON.parse(fsSync.readFileSync(statePath(id), 'utf8')) as InstalledPluginState;
    if (!state.enabled || !state.activeVersion) return null;
    safeVersion(state.activeVersion);
    const target = path.join(versionPath(id, state.activeVersion), relativePath ? validatePluginArchivePath(relativePath) : '');
    return fsSync.existsSync(target) ? target : null;
  } catch { return null; }
}

/** Compatibility wrapper for the legacy marketplace API. */
export async function installMarketplacePlugin(entry: MarketplacePlugin): Promise<{ path: string; sha256: string; bundle: string }> {
  if (!entry.version || !entry.downloadUrl || !entry.sha256) throw new Error('PLUGIN_VERSION_REQUIRED');
  const installed = await installPluginPackage({ pluginId: entry.id, version: entry.version, artifact: { url: entry.downloadUrl, sha256: entry.sha256, size: entry.size } });
  return { path: installed.path, sha256: entry.sha256, bundle: JSON.stringify(installed.manifest) };
}

async function fetchMarketplaceBytes(url: string, maximum: number, prefix: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error(`${prefix}_URL_MUST_USE_HTTPS`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) throw new Error(`${prefix}_HTTP_${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maximum) throw new Error(`${prefix}_PACKAGE_TOO_LARGE`);
  if (!response.body) throw new Error(`${prefix}_EMPTY_RESPONSE`);
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (done) continue;
    const { value } = result;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new Error(`${prefix}_PACKAGE_TOO_LARGE`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function destinationFor(id: string, version: string): string {
  return versionPath(id, version);
}
