import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/test-user-data',
    getVersion: () => '0.3.0',
  },
}));

let satisfiesVersion: typeof import('../../src/main/plugin-marketplace').satisfiesVersion;
let validatePluginArchivePath: typeof import('../../src/main/plugin-marketplace').validatePluginArchivePath;

beforeAll(async () => {
  ({ satisfiesVersion, validatePluginArchivePath } = await import('../../src/main/plugin-marketplace'));
});

describe('plugin marketplace compatibility', () => {
  it('supports bounded app version ranges', () => {
    expect(satisfiesVersion('0.3.0', '>=0.2.0 <0.4.0')).toBe(true);
    expect(satisfiesVersion('0.4.0', '>=0.2.0 <0.4.0')).toBe(false);
  });

  it('supports compatible and patch ranges', () => {
    expect(satisfiesVersion('2.4.1', '^2.1.0')).toBe(true);
    expect(satisfiesVersion('3.0.0', '^2.1.0')).toBe(false);
    expect(satisfiesVersion('2.4.9', '~2.4.0')).toBe(true);
  });
});

describe('plugin archive paths', () => {
  it('normalizes safe relative paths', () => {
    expect(validatePluginArchivePath('resources\\win32\\mpv.exe')).toBe('resources/win32/mpv.exe');
  });

  it.each(['../outside.exe', '/absolute/file', 'C:/outside.exe', 'nested/../../outside.exe'])(
    'rejects unsafe path %s',
    (value) => expect(() => validatePluginArchivePath(value)).toThrow('PLUGIN_ARCHIVE_UNSAFE_PATH'),
  );
});
