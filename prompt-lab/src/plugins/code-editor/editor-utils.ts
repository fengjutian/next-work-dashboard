export function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.some((byte) => byte === 0)) {
    throw new Error('检测到二进制内容，代码编辑器仅支持文本文件');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function languageIdFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const languages: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', html: 'html', css: 'css', scss: 'scss', less: 'less',
    vue: 'html', svelte: 'html', json: 'json', jsonc: 'json',
    md: 'markdown', sql: 'sql', sh: 'shell', ps1: 'powershell',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', php: 'php', rb: 'ruby',
    swift: 'swift', toml: 'ini', env: 'ini',
  };
  return languages[extension] ?? 'plaintext';
}

export function languageFromName(name: string): string {
  const id = languageIdFromName(name);
  const labels: Record<string, string> = {
    plaintext: 'Plain Text',
    javascript: name.toLowerCase().endsWith('x') ? 'JavaScript React' : 'JavaScript',
    typescript: name.toLowerCase().endsWith('x') ? 'TypeScript React' : 'TypeScript',
    csharp: 'C#',
    cpp: 'C++',
    powershell: 'PowerShell',
  };
  return labels[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function hasGitConflictMarkers(content: string): boolean {
  return /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/m.test(content);
}
