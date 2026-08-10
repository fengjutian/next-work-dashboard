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

export async function installOnlinePlugin(entry: MarketplacePlugin): Promise<{ ok: boolean; message: string }> {
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

export function availableUpdates(catalog: MarketplaceCatalog | null): MarketplacePlugin[] {
  if (!catalog) return [];
  const installed = new Map(loadUserPlugins().map((item) => [item.id, item.manifest?.version ?? '0.0.0']));
  return catalog.plugins.filter((item) => {
    const version = installed.get(item.id);
    return version !== undefined && compareVersion(item.version, version) > 0;
  });
}
