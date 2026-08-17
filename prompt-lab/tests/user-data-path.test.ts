import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUserDataPath } from '../src/main/user-data-path';

describe('user data path isolation', () => {
  it('keeps the packaged application on the stable production profile', () => {
    expect(resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', true))
      .toBe(path.join('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard-production'));
  });

  it('uses a separate profile during development', () => {
    const production = resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', true);
    const development = resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard', false);
    expect(development).toBe(path.join('C:\\Users\\tester\\AppData\\Roaming', 'next-work-dashboard-development'));
    expect(development).not.toBe(production);
  });
});
