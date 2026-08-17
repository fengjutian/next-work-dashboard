import { describe, expect, it, vi } from 'vitest';
import { registerPluginRuntimeHook, switchPluginRuntime } from '../../src/main/plugin-runtime-hooks';

describe('plugin runtime version switching', () => {
  it('stops and restarts a running plugin around activation', async () => {
    const calls: string[] = [];
    const dispose = registerPluginRuntimeHook('voice-input', {
      isRunning: () => true,
      stop: async () => { calls.push('stop'); },
      start: async () => { calls.push('start'); },
    });
    await switchPluginRuntime('voice-input', async () => { calls.push('activate'); }, async () => { calls.push('restore'); });
    dispose();
    expect(calls).toEqual(['stop', 'activate', 'start']);
  });

  it('restores the previous version when the new runtime fails', async () => {
    const calls: string[] = [];
    const start = vi.fn(async () => {
      calls.push('start');
      if (start.mock.calls.length === 1) throw new Error('health check failed');
    });
    const dispose = registerPluginRuntimeHook('network-observatory', {
      isRunning: () => true,
      stop: async () => { calls.push('stop'); },
      start,
    });
    await expect(switchPluginRuntime('network-observatory', async () => { calls.push('activate'); }, async () => { calls.push('restore'); })).rejects.toThrow('health check failed');
    dispose();
    expect(calls).toEqual(['stop', 'activate', 'start', 'restore', 'start']);
  });
});
