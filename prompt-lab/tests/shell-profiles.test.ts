import { describe, expect, it } from 'vitest';
import { discoverShellProfiles } from '../src/terminal/shell-profiles';

describe('discoverShellProfiles', () => {
  it('discovers Windows built-ins and installed Git Bash', () => {
    const profiles = discoverShellProfiles('win32', {}, (path) => path.includes('Git'));
    expect(profiles.map((profile) => profile.name)).toEqual(['PowerShell', 'PowerShell 7', 'Command Prompt', 'Git Bash', 'WSL']);
  });
  it('prioritizes SHELL and removes duplicates', () => {
    const profiles = discoverShellProfiles('linux', { SHELL: '/bin/bash' }, (path) => path === '/bin/bash');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].source).toBe('environment');
  });
});
