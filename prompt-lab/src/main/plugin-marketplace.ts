import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { InstalledPluginState, InstalledPluginVersion, MarketplaceCatalog, MarketplacePlugin, PluginArtifact, PluginDataMigration, PluginInstallProgress, PluginInstallRequest, PluginPackageManifest } from '../core/plugin-platform/types';
import { switchPluginRuntime } from './plugin-runtime-hooks';

export type { MarketplaceCatalog, MarketplacePlugin } from '../core/plugin-platform/types';
export const MAX_PLUGIN_PACKAGE_SIZE = 2 * 1024 * 1024;
export const MAX_VERSIONED_PLUGIN_PACKAGE_SIZE = 512 * 1024 * 1024;
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
const downloadPath = (id: string, version: string) => path.join(root(), 'downloads', `${id}-${version}.zip.part`);
const activeDownloads = new Map<string, AbortController>();
const RESOURCE_PACKAGE_BY_FEATURE = new Map([
  ['video-player', 'video-player'],
  ['office-studio', 'office-studio'],
  ['voice-input', 'voice-input'],
  ['network-observatory', 'network-observatory'],
  ['document-knowledge', 'vector-runtime'],
  ['work-browser', 'vector-runtime'],
]);

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
  verifyCatalogSignature(catalog);
  return catalog;
}

function verifyCatalogSignature(catalog: MarketplaceCatalog): void {
  const configured = process.env.NWD_MARKETPLACE_PUBLIC_KEY_PATH;
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'plugin-marketplace-public.pem')
    : path.join(app.getAppPath(), 'resources', 'plugin-marketplace-public.pem');
  const keyPath = configured?.trim() || bundled;
  if (!fsSync.existsSync(keyPath)) return;
  if (!catalog.signature?.value) throw new Error('MARKETPLACE_SIGNATURE_REQUIRED');
  const payload = Buffer.from(JSON.stringify({ schemaVersion: catalog.schemaVersion, plugins: catalog.plugins }));
  const publicKey = fsSync.readFileSync(keyPath, 'utf8');
  if (!crypto.verify(null, payload, publicKey, Buffer.from(catalog.signature.value, 'base64'))) throw new Error('MARKETPLACE_SIGNATURE_INVALID');
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

async function extractPackage(bytes: Buffer, destination: string, onProgress?: (completed: number, total: number) => void): Promise<void> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(archive.files);
  if (entries.length > MAX_PLUGIN_FILE_COUNT) throw new Error('PLUGIN_ARCHIVE_TOO_MANY_FILES');
  let extractedSize = 0;
  let completed = 0;
  for (const entry of entries) {
    const relative = validatePluginArchivePath(entry.name);
    if (entry.dir) { completed += 1; onProgress?.(completed, entries.length); continue; }
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
    completed += 1;
    onProgress?.(completed, entries.length);
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

export async function installPluginPackage(request: PluginInstallRequest, report?: (progress: PluginInstallProgress) => void): Promise<InstalledPluginVersion> {
  const id = safeId(request.pluginId);
  const version = safeVersion(request.version);
  validateArtifact(request.artifact);
  try { await fs.access(destinationFor(id, version)); throw new Error('PLUGIN_VERSION_ALREADY_INSTALLED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const emit = (phase: PluginInstallProgress['phase'], details: Partial<PluginInstallProgress> = {}) => report?.({ pluginId: id, version, phase, ...details });
  let bytes: Buffer;
  try {
    emit('downloading', { receivedBytes: 0, totalBytes: request.artifact.size, percent: 0 });
    bytes = await downloadPluginPackage(id, version, request.artifact, (receivedBytes, totalBytes) => {
      emit('downloading', { receivedBytes, totalBytes, percent: totalBytes ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : undefined });
    });
    emit('verifying');
    if (request.artifact.size && bytes.length !== request.artifact.size) throw new Error('PLUGIN_PACKAGE_SIZE_INVALID');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest.toLowerCase() !== request.artifact.sha256.toLowerCase()) throw new Error('PLUGIN_SHA256_MISMATCH');
    verifySignature(bytes, request.artifact);
  } catch (error) {
    if ((error as Error).name !== 'AbortError') await fs.rm(downloadPath(id, version), { force: true });
    emit('failed', { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  const staging = path.join(root(), 'staging', `${id}-${version}-${crypto.randomUUID()}`);
  const destination = destinationFor(id, version);
  await fs.mkdir(staging, { recursive: true });
  try {
    emit('extracting', { percent: 0 });
    await extractPackage(bytes, staging, (completed, total) => emit('extracting', { percent: Math.round(completed / total * 100) }));
    const manifest = parseManifest(JSON.parse(await fs.readFile(path.join(staging, 'plugin.json'), 'utf8')), id, version);
    await migratePluginData(manifest);
    emit('installing');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(staging, destination);
    const state = await loadState(id);
    if (!state.installedVersions.includes(version)) state.installedVersions.push(version);
    if (request.activate !== false) {
      const original = { ...state, installedVersions: [...state.installedVersions] };
      await switchPluginRuntime(id, async () => {
        state.previousVersion = state.activeVersion && state.activeVersion !== version ? state.activeVersion : state.previousVersion;
        state.activeVersion = version;
        state.enabled = true;
        await saveState(state);
      }, () => saveState(original));
    }
    else await saveState(state);
    const result = { manifest, path: destination, active: state.activeVersion === version };
    await fs.rm(downloadPath(id, version), { force: true });
    emit('completed', { percent: 100 });
    return result;
  } catch (error) {
    emit('failed', { message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

export function cancelPluginInstall(id: string, version: string): boolean {
  safeId(id); safeVersion(version);
  const controller = activeDownloads.get(`${id}@${version}`);
  if (!controller) return false;
  controller.abort();
  return true;
}

async function downloadPluginPackage(id: string, version: string, artifact: PluginArtifact, onProgress: (received: number, total?: number) => void): Promise<Buffer> {
  const target = downloadPath(id, version);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let existing = 0;
  try { existing = (await fs.stat(target)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing > MAX_VERSIONED_PLUGIN_PACKAGE_SIZE || (artifact.size && existing > artifact.size)) {
    await fs.rm(target, { force: true }); existing = 0;
  }
  if (artifact.size && existing === artifact.size) {
    onProgress(existing, artifact.size);
    return fs.readFile(target);
  }
  if (existing) onProgress(existing, artifact.size);
  const parsed = validatedDownloadUrl(artifact.url, 'PLUGIN');
  const controller = new AbortController();
  const key = `${id}@${version}`;
  if (activeDownloads.has(key)) throw new Error('PLUGIN_DOWNLOAD_ALREADY_RUNNING');
  activeDownloads.set(key, controller);
  const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'error',
      headers: existing ? { Range: `bytes=${existing}-` } : undefined,
    });
    if (!response.ok && response.status !== 206) throw new Error(`PLUGIN_HTTP_${response.status}`);
    const resumed = existing > 0 && response.status === 206;
    if (!resumed && existing) { await fs.truncate(target, 0); existing = 0; }
    const remaining = Number(response.headers.get('content-length') || 0);
    const totalSize = artifact.size ?? (remaining ? existing + remaining : undefined);
    if (totalSize && totalSize > MAX_VERSIONED_PLUGIN_PACKAGE_SIZE) throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
    if (!response.body) throw new Error('PLUGIN_EMPTY_RESPONSE');
    const handle = await fs.open(target, resumed ? 'a' : 'w');
    let received = existing;
    try {
      const reader = response.body.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done) continue;
        received += result.value.byteLength;
        if (received > MAX_VERSIONED_PLUGIN_PACKAGE_SIZE) { await reader.cancel(); throw new Error('PLUGIN_PACKAGE_TOO_LARGE'); }
        await handle.write(Buffer.from(result.value));
        onProgress(received, totalSize);
      }
    } finally { await handle.close(); }
    return fs.readFile(target);
  } finally {
    clearTimeout(timeout);
    activeDownloads.delete(key);
  }
}

async function migratePluginData(manifest: PluginPackageManifest): Promise<void> {
  const migrations = [...(manifest.migrations ?? [])].sort((left, right) => left.from - right.from);
  const dataRoot = path.join(root(), 'data', manifest.id);
  const stateFile = path.join(dataRoot, '.data-version.json');
  await fs.mkdir(dataRoot, { recursive: true });
  let current = 0;
  try { current = Number(JSON.parse(await fs.readFile(stateFile, 'utf8')).version || 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const target = manifest.dataVersion ?? current;
  if (target <= current) return;
  const plan = planPluginMigrations(current, target, migrations);
  const backup = path.join(root(), 'migration-backups', manifest.id, `${current}-${target}-${Date.now()}`);
  await fs.cp(dataRoot, backup, { recursive: true, force: true });
  try {
    for (const migration of plan) {
      for (const operation of migration.operations) {
        if (operation.type === 'mkdir') await fs.mkdir(path.join(dataRoot, validatePluginArchivePath(operation.path)), { recursive: true });
        else {
          const from = path.join(dataRoot, validatePluginArchivePath(operation.from));
          const to = path.join(dataRoot, validatePluginArchivePath(operation.to));
          await fs.mkdir(path.dirname(to), { recursive: true });
          if (operation.type === 'copy') await fs.cp(from, to, { recursive: true, force: true });
          else await fs.rename(from, to);
        }
      }
      current = migration.to;
      await atomicWrite(stateFile, `${JSON.stringify({ version: current, updatedAt: Date.now() }, null, 2)}\n`);
    }
  } catch (error) {
    await fs.rm(dataRoot, { recursive: true, force: true });
    await fs.cp(backup, dataRoot, { recursive: true, force: true });
    throw error;
  }
}

export function planPluginMigrations(current: number, target: number, migrations: PluginDataMigration[]): PluginDataMigration[] {
  const plan: PluginDataMigration[] = [];
  let cursor = current;
  while (cursor < target) {
    const migration = migrations.find((item) => item.from === cursor);
    if (!migration || migration.to <= cursor || migration.to > target) throw new Error('PLUGIN_DATA_MIGRATION_PATH_MISSING');
    plan.push(migration);
    cursor = migration.to;
  }
  return plan;
}

async function assertDataVersionCompatible(id: string, manifest: PluginPackageManifest): Promise<void> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root(), 'data', id, '.data-version.json'), 'utf8')) as { version?: number };
    const current = Number(value.version || 0);
    if ((manifest.dataVersion ?? 0) < current) throw new Error('PLUGIN_DATA_VERSION_PREVENTS_ROLLBACK');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function installCatalogPlugin(pluginId: string, version: string, activate = true, report?: (progress: PluginInstallProgress) => void): Promise<InstalledPluginVersion> {
  const catalog = await loadCachedCatalog();
  const plugin = catalog?.plugins.find((item) => item.id === pluginId);
  const release = plugin?.versions?.find((item) => item.version === version);
  if (!plugin || !release) throw new Error('PLUGIN_RELEASE_NOT_FOUND');
  const artifact = release.artifacts[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error('PLUGIN_PLATFORM_NOT_SUPPORTED');
  return installPluginPackage({ pluginId, version, artifact, activate }, report);
}

export async function getPluginResourceRequirement(pluginId: string): Promise<import('../core/plugin-platform/types').PluginResourceRequirement> {
  safeId(pluginId);
  const packageId = RESOURCE_PACKAGE_BY_FEATURE.get(pluginId);
  if (!packageId) return { pluginId, required: false, installed: true };
  const state = await loadState(packageId);
  if ((state.enabled && state.activeVersion) || hasBundledPluginResource(packageId)) return { pluginId, required: true, installed: true, version: state.activeVersion ?? 'bundled' };
  const catalog = await loadCachedCatalog();
  const plugin = catalog?.plugins.find((item) => item.id === packageId);
  const release = plugin?.versions
    ?.filter((item) => (item.channel ?? 'stable') === 'stable')
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  const artifact = release?.artifacts[`${process.platform}-${process.arch}`];
  return { pluginId, required: true, installed: false, version: release?.version, size: artifact?.size };
}

function hasBundledPluginResource(pluginId: string): boolean {
  const resourceRoot = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
  const executable = process.platform === 'win32' ? '.exe' : '';
  const candidates: Record<string, string[]> = {
    'video-player': [path.join(resourceRoot, 'video-player', process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux', `mpv${executable}`)],
    'office-studio': [path.join(resourceRoot, 'officecli', `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, `officecli${executable}`)],
    'voice-input': [path.join(resourceRoot, 'voice-engine', `nwd-voice-engine${executable}`)],
    'network-observatory': [path.join(resourceRoot, 'net-probe', `nwd-net-probe${executable}`)],
    'vector-runtime': [
      path.join(resourceRoot, 'app.asar.unpacked', 'node_modules', lancedbNativePackageName(), lancedbNativeFilename()),
      ...(!app.isPackaged ? [path.join(app.getAppPath(), 'node_modules', lancedbNativePackageName(), lancedbNativeFilename())] : []),
    ],
  };
  return (candidates[pluginId] ?? []).some((candidate) => fsSync.existsSync(candidate));
}

function lancedbNativePackageName(): string {
  if (process.platform === 'win32') return `@lancedb/lancedb-win32-${process.arch}-msvc`;
  if (process.platform === 'darwin') return `@lancedb/lancedb-darwin-${process.arch}`;
  return `@lancedb/lancedb-linux-${process.arch}-gnu`;
}

function lancedbNativeFilename(): string {
  if (process.platform === 'win32') return `lancedb.win32-${process.arch}-msvc.node`;
  if (process.platform === 'darwin') return `lancedb.darwin-${process.arch}.node`;
  return `lancedb.linux-${process.arch}-gnu.node`;
}

export async function ensurePluginResource(pluginId: string, report?: (progress: PluginInstallProgress) => void): Promise<InstalledPluginVersion | null> {
  const requirement = await getPluginResourceRequirement(pluginId);
  if (!requirement.required || requirement.installed) return null;
  if (!requirement.version) throw new Error('PLUGIN_RESOURCE_RELEASE_NOT_FOUND');
  return installCatalogPlugin(RESOURCE_PACKAGE_BY_FEATURE.get(pluginId) ?? pluginId, requirement.version, true, report);
}

export async function listInstalledPlugins(): Promise<InstalledPluginState[]> {
  try {
    const entries = await fs.readdir(path.join(root(), 'packages'), { withFileTypes: true });
    return Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => loadState(entry.name)));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function activatePluginVersion(id: string, version: string): Promise<InstalledPluginState> {
  safeId(id); safeVersion(version);
  const manifestFile = path.join(versionPath(id, version), 'plugin.json');
  await fs.access(manifestFile);
  await assertDataVersionCompatible(id, JSON.parse(await fs.readFile(manifestFile, 'utf8')) as PluginPackageManifest);
  const state = await loadState(id);
  if (!state.installedVersions.includes(version)) state.installedVersions.push(version);
  const original = { ...state, installedVersions: [...state.installedVersions] };
  await switchPluginRuntime(id, async () => {
    state.previousVersion = state.activeVersion && state.activeVersion !== version ? state.activeVersion : state.previousVersion;
    state.activeVersion = version; state.enabled = true;
    await saveState(state);
  }, () => saveState(original));
  return state;
}

export async function rollbackPlugin(id: string): Promise<InstalledPluginState> {
  const state = await loadState(safeId(id));
  if (!state.previousVersion) throw new Error('PLUGIN_ROLLBACK_VERSION_MISSING');
  const previous = state.previousVersion;
  const manifestFile = path.join(versionPath(id, previous), 'plugin.json');
  await fs.access(manifestFile);
  await assertDataVersionCompatible(id, JSON.parse(await fs.readFile(manifestFile, 'utf8')) as PluginPackageManifest);
  const original = { ...state, installedVersions: [...state.installedVersions] };
  await switchPluginRuntime(id, async () => {
    state.previousVersion = state.activeVersion; state.activeVersion = previous; state.enabled = true;
    await saveState(state);
  }, () => saveState(original));
  return state;
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
  safeId(entry.id); safeVersion(entry.version);
  const bytes = await fetchMarketplaceBytes(entry.downloadUrl, MAX_PLUGIN_PACKAGE_SIZE, 'PLUGIN');
  if (entry.size && bytes.length !== entry.size) throw new Error('PLUGIN_PACKAGE_SIZE_INVALID');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error('PLUGIN_SHA256_MISMATCH');
  const installPath = path.join(root(), 'installed', entry.id, entry.version, `${entry.id}.nwd`);
  await atomicWrite(installPath, bytes);
  return { path: installPath, sha256: digest, bundle: bytes.toString('utf8') };
}

async function fetchMarketplaceBytes(url: string, maximum: number, prefix: string, onProgress?: (received: number, total?: number) => void): Promise<Buffer> {
  const parsed = validatedDownloadUrl(url, prefix);
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
    onProgress?.(total, declared || undefined);
  }
  return Buffer.concat(chunks, total);
}

function validatedDownloadUrl(url: string, prefix: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error(`${prefix}_URL_MUST_USE_HTTPS`);
  return parsed;
}

function destinationFor(id: string, version: string): string {
  return versionPath(id, version);
}
