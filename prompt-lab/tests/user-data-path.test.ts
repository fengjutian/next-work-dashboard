import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUserDataPath } from '../src/main/user-data-path';

describe('shared user data path', () => {
  it('keeps the packaged application on the stable profile', () => {
    expect(resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', true))
      .toBe(path.join('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard-production'));
  });

  it('uses the packaged application profile during development', () => {
    const production = resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', true);
    const development = resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', false);
    expect(development).toBe(path.join('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard-production'));
    expect(development).toBe(production);
  });
});
