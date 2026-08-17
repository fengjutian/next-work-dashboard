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
  dataVersion?: number;
  migrations?: PluginDataMigration[];
  packageResources?: Array<{ from: string; to?: string }>;
}

export type PluginDataMigrationOperation =
  | { type: 'mkdir'; path: string }
  | { type: 'copy'; from: string; to: string }
  | { type: 'move'; from: string; to: string };

export interface PluginDataMigration {
  from: number;
  to: number;
  operations: PluginDataMigrationOperation[];
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
  signature?: { keyId: string; value: string };
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

export type PluginInstallPhase = 'downloading' | 'verifying' | 'extracting' | 'installing' | 'completed' | 'failed';

export interface PluginInstallProgress {
  pluginId: string;
  version: string;
  phase: PluginInstallPhase;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
  message?: string;
}

export interface PluginResourceRequirement {
  pluginId: string;
  required: boolean;
  installed: boolean;
  version?: string;
  size?: number;
}
