import fs from 'node:fs';

export interface DiscoveredShellProfile { name: string; shell: string; args?: string[]; source: 'system' | 'environment' }

export function discoverShellProfiles(platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): DiscoveredShellProfile[] {
  const candidates: DiscoveredShellProfile[] = platform === 'win32' ? [
    { name: 'PowerShell', shell: 'powershell.exe', source: 'system' },
    { name: 'PowerShell 7', shell: 'pwsh.exe', source: 'system' },
    { name: 'Command Prompt', shell: 'cmd.exe', source: 'system' },
    { name: 'Git Bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['-i'], source: 'system' },
    { name: 'WSL', shell: 'wsl.exe', source: 'system' },
  ] : [
    ...(env.SHELL ? [{ name: `Default (${env.SHELL.split('/').pop()})`, shell: env.SHELL, source: 'environment' as const }] : []),
    { name: 'zsh', shell: '/bin/zsh', source: 'system' },
    { name: 'bash', shell: '/bin/bash', source: 'system' },
    { name: 'fish', shell: '/usr/bin/fish', source: 'system' },
    { name: 'sh', shell: '/bin/sh', source: 'system' },
  ];
  const executableByName = platform === 'win32' && new Set(['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl.exe']);
  return candidates.filter((profile, index) => (executableByName && executableByName.has(profile.shell)) || exists(profile.shell))
    .filter((profile, index, all) => all.findIndex((item) => item.shell.toLowerCase() === profile.shell.toLowerCase()) === index);
}
