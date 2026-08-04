export interface AgentEditScope { kind: 'workspace' | 'directory' | 'files'; paths: string[]; label: string }

export function pathInAgentScope(filePath: string, scope: AgentEditScope): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (scope.kind === 'workspace') return true;
  if (scope.kind === 'directory') {
    const directory = (scope.paths[0] ?? '').replace(/\\/g, '/').replace(/\/$/, '');
    return Boolean(directory) && normalized.startsWith(`${directory}/`);
  }
  return scope.paths.some((selected) => selected.replace(/\\/g, '/') === normalized);
}
