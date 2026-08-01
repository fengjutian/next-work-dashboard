export type GitConflictKind = 'add/add' | 'delete/modify' | 'modify/delete' | 'both deleted' | 'both modified' | 'unmerged';

export function classifyConflictStatus(status: string): GitConflictKind | undefined {
  const code = status.slice(0, 2);
  if (code === 'AA') return 'add/add';
  if (code === 'DU' || code === 'UD') return code === 'DU' ? 'delete/modify' : 'modify/delete';
  if (code === 'DD') return 'both deleted';
  if (code === 'UU') return 'both modified';
  if (['AU', 'UA'].includes(code)) return 'unmerged';
  return undefined;
}
