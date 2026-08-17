import type { MarketplaceCatalog, MarketplacePlugin } from '@/types/electron';
import { importPluginText } from './import-export';
import { loadUserPlugins } from './user-plugin-store';

const SOURCE_KEY = 'plugin-marketplace-url-v1';

export function getMarketplaceUrl(): string { return localStorage.getItem(SOURCE_KEY) ?? ''; }
export function setMarketplaceUrl(url: string): void { localStorage.setItem(SOURCE_KEY, url.trim()); }

export async function loadMarketplace(refresh = false): Promise<MarketplaceCatalog | null> {
  const url = getMarketplaceUrl();
  if (refresh && url) return window.electronAPI.plugins.fetchCatalog(url);
  return window.electronAPI.plugins.getCachedCatalog();
}

export async function installOnlinePlugin(entry: MarketplacePlugin, requestedVersion?: string): Promise<{ ok: boolean; message: string }> {
  if (entry.versions?.length) {
    const releases = [...entry.versions]
      .filter((item) => (item.channel ?? 'stable') === 'stable')
      .sort((left, right) => compareVersion(right.version, left.version));
    const release = requestedVersion ? releases.find((item) => item.version === requestedVersion) : releases[0];
    if (!release) return { ok: false, message: '没有可安装的稳定版本' };
    await window.electronAPI.plugins.installCatalogVersion(entry.id, release.version, true);
    return { ok: true, message: `已安装插件包: ${entry.name} v${release.version}` };
  }
  const downloaded = await window.electronAPI.plugins.install(entry);
  return importPluginText(downloaded.bundle);
}

function compareVersion(a: string, b: string): number {
  const left = a.split(/[.-]/).map(Number);
  const right = b.split(/[.-]/).map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function marketplacePluginVersion(entry: MarketplacePlugin): string {
  return entry.versions?.map((item) => item.version).sort((left, right) => compareVersion(right, left))[0] ?? entry.version;
}

export function availableUpdates(catalog: MarketplaceCatalog | null): MarketplacePlugin[] {
  if (!catalog) return [];
  const installed = new Map(loadUserPlugins().map((item) => [item.id, item.manifest?.version ?? '0.0.0']));
  return catalog.plugins.filter((item) => {
    const version = installed.get(item.id);
    return version !== undefined && compareVersion(marketplacePluginVersion(item), version) > 0;
  });
}
