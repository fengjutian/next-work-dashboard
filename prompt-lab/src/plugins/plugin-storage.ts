import type { PluginPermission } from './sandbox/types';

const PLATFORM_STORAGE_KEY = 'plugin-platform-state-v1';
const LEGACY_PLUGIN_KEY = 'plugin-manager-user-plugins';
const LEGACY_DATA_PREFIX = 'pksdk:data:';

export interface PluginRevision {
  version: string;
  definition: unknown;
  savedAt: number;
}

export interface PluginLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface StoredPluginRecord {
  definition?: unknown;
  enabled?: boolean;
  grants: PluginPermission[];
  config: Record<string, unknown>;
  data: Record<string, unknown>;
  revisions: PluginRevision[];
  logs: PluginLogEntry[];
  crashCount: number;
  disabledByCrash?: boolean;
}

interface PluginPlatformState {
  version: 1;
  safeMode: boolean;
  plugins: Record<string, StoredPluginRecord>;
}

const emptyRecord = (): StoredPluginRecord => ({
  grants: [], config: {}, data: {}, revisions: [], logs: [], crashCount: 0,
});

function readState(): PluginPlatformState {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PluginPlatformState;
  } catch { /* migrate below */ }

  const state: PluginPlatformState = { version: 1, safeMode: false, plugins: {} };
  try {
    const definitions = JSON.parse(localStorage.getItem(LEGACY_PLUGIN_KEY) ?? '[]') as Array<Record<string, unknown>>;
    for (const definition of definitions) {
      if (typeof definition.id !== 'string') continue;
      const legacyData = JSON.parse(localStorage.getItem(LEGACY_DATA_PREFIX + definition.id) ?? '{}') as Record<string, unknown>;
      const config = typeof legacyData.$config === 'object' && legacyData.$config !== null
        ? legacyData.$config as Record<string, unknown>
        : {};
      delete legacyData.$config;
      state.plugins[definition.id] = {
        ...emptyRecord(), definition, enabled: definition.enabled as boolean | undefined,
        grants: Array.isArray(definition.permissions) ? definition.permissions as PluginPermission[] : [],
        config, data: legacyData,
      };
    }
  } catch { /* start clean without destroying legacy keys */ }
  writeState(state);
  return state;
}

function writeState(state: PluginPlatformState): void {
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(state));
}

function updateRecord(pluginId: string, update: (record: StoredPluginRecord) => void): void {
  const state = readState();
  const record = state.plugins[pluginId] ?? emptyRecord();
  update(record);
  state.plugins[pluginId] = record;
  writeState(state);
}

export const pluginStorage = {
  loadDefinitions<T>(): T[] {
    return Object.values(readState().plugins)
      .map((record) => record.definition)
      .filter((definition): definition is T => definition !== undefined);
  },
  saveDefinitions<T extends { id: string; enabled?: boolean; permissions?: PluginPermission[] }>(definitions: T[]): void {
    const state = readState();
    const ids = new Set(definitions.map((definition) => definition.id));
    for (const [id, record] of Object.entries(state.plugins)) {
      if (record.definition !== undefined && !ids.has(id)) delete state.plugins[id];
    }
    for (const definition of definitions) {
      const record = state.plugins[definition.id] ?? emptyRecord();
      record.definition = definition;
      record.enabled = definition.enabled;
      record.grants = definition.permissions ?? record.grants;
      state.plugins[definition.id] = record;
    }
    writeState(state);
  },
  clearDefinitions(): void {
    const state = readState();
    for (const record of Object.values(state.plugins)) delete record.definition;
    writeState(state);
  },
  getData(pluginId: string): Record<string, unknown> { return { ...(readState().plugins[pluginId]?.data ?? {}) }; },
  setData(pluginId: string, data: Record<string, unknown>): void { updateRecord(pluginId, (record) => { record.data = data; }); },
  getConfig(pluginId: string): Record<string, unknown> { return { ...(readState().plugins[pluginId]?.config ?? {}) }; },
  setConfig(pluginId: string, config: Record<string, unknown>): void { updateRecord(pluginId, (record) => { record.config = config; }); },
  getGrants(pluginId: string): PluginPermission[] { return [...(readState().plugins[pluginId]?.grants ?? [])]; },
  setGrants(pluginId: string, grants: PluginPermission[]): void { updateRecord(pluginId, (record) => { record.grants = [...grants]; }); },
  isSafeMode(): boolean { return readState().safeMode; },
  setSafeMode(value: boolean): void { const state = readState(); state.safeMode = value; writeState(state); },
  appendLog(pluginId: string, entry: PluginLogEntry): void {
    updateRecord(pluginId, (record) => { record.logs = [...record.logs, entry].slice(-200); });
  },
  getLogs(pluginId: string): PluginLogEntry[] { return [...(readState().plugins[pluginId]?.logs ?? [])]; },
  recordCrash(pluginId: string): number {
    let count = 0;
    updateRecord(pluginId, (record) => {
      record.crashCount += 1;
      count = record.crashCount;
      if (count >= 3) record.disabledByCrash = true;
    });
    return count;
  },
  clearCrashes(pluginId: string): void { updateRecord(pluginId, (record) => { record.crashCount = 0; record.disabledByCrash = false; }); },
  isCrashDisabled(pluginId: string): boolean { return readState().plugins[pluginId]?.disabledByCrash === true; },
  addRevision(pluginId: string, revision: PluginRevision): void {
    updateRecord(pluginId, (record) => { record.revisions = [...record.revisions, revision].slice(-5); });
  },
  getRevisions(pluginId: string): PluginRevision[] { return [...(readState().plugins[pluginId]?.revisions ?? [])]; },
};
