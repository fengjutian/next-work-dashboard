export type PluginReleaseChannel = 'stable' | 'beta' | 'dev';

export interface PluginPackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  pluginApiVersion: number;
  description?: string;
  channel?: PluginReleaseChannel;
  engines?: { app?: string };
  entrypoints?: { main?: string; renderer?: string; preload?: string };
  resources?: Record<string, { version: string; executable?: string }>;
  permissions?: string[];
}

export interface PluginArtifact {
  url: string;
  sha256: string;
  size?: number;
  signature?: string;
  publicKey?: string;
}

export interface MarketplacePluginVersion {
  version: string;
  channel?: PluginReleaseChannel;
  engines?: { app?: string };
  artifacts: Record<string, PluginArtifact>;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  versions?: MarketplacePluginVersion[];
}

export interface MarketplaceCatalog {
  schemaVersion: 1;
  plugins: MarketplacePlugin[];
  fetchedAt?: number;
}

export interface InstalledPluginState {
  id: string;
  enabled: boolean;
  activeVersion: string | null;
  previousVersion: string | null;
  installedVersions: string[];
  channel: PluginReleaseChannel;
  updatedAt: number;
}

export interface InstalledPluginVersion {
  manifest: PluginPackageManifest;
  path: string;
  active: boolean;
}

export interface PluginInstallRequest {
  pluginId: string;
  version: string;
  artifact: PluginArtifact;
  activate?: boolean;
}
