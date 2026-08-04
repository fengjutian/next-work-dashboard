// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { pluginStorage } from '../src/plugins/plugin-storage';

describe('pluginStorage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps definitions, grants, config, and private data in one platform record', () => {
    pluginStorage.saveDefinitions([{ id: 'demo', enabled: true, permissions: ['data' as const] }]);
    pluginStorage.setConfig('demo', { pageSize: 20 });
    pluginStorage.setData('demo', { value: 1 });

    expect(pluginStorage.loadDefinitions<{ id: string }>()).toEqual([expect.objectContaining({ id: 'demo' })]);
    expect(pluginStorage.getGrants('demo')).toEqual(['data']);
    expect(pluginStorage.getConfig('demo')).toEqual({ pageSize: 20 });
    expect(pluginStorage.getData('demo')).toEqual({ value: 1 });
  });

  it('tracks revisions, bounded logs, crashes, and safe mode', () => {
    pluginStorage.addRevision('demo', { version: '1.0.0', definition: { id: 'demo' }, savedAt: 1 });
    pluginStorage.appendLog('demo', { timestamp: 1, level: 'error', message: 'boom' });
    pluginStorage.recordCrash('demo');
    pluginStorage.recordCrash('demo');
    pluginStorage.recordCrash('demo');
    pluginStorage.setSafeMode(true);

    expect(pluginStorage.getRevisions('demo')).toHaveLength(1);
    expect(pluginStorage.getLogs('demo')[0].message).toBe('boom');
    expect(pluginStorage.isCrashDisabled('demo')).toBe(true);
    expect(pluginStorage.isSafeMode()).toBe(true);
  });
});
