export interface UnmergedIndexEntry { stage: 1 | 2 | 3; path: string }
export interface RenameConflictGroup { type: 'rename/rename'; basePath: string; oursPath: string; theirsPath: string }

export function parseUnmergedIndex(output: string): UnmergedIndexEntry[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\d+\s+[0-9a-f]+\s+([123])\t(.+)$/.exec(line);
    return match ? [{ stage: Number(match[1]) as 1 | 2 | 3, path: match[2].replace(/\\/g, '/') }] : [];
  });
}

export function detectRenameRename(statuses: Array<{ status: string; path: string }>, entries: UnmergedIndexEntry[], requestedPath: string): RenameConflictGroup | undefined {
  const normalized = requestedPath.replace(/\\/g, '/');
  const base = statuses.find((item) => item.status === 'DD' && item.path.replace(/\\/g, '/') === normalized);
  if (!base) return undefined;
  const oursCandidates = statuses.filter((item) => item.status === 'AU').map((item) => item.path.replace(/\\/g, '/'));
  const theirsCandidates = statuses.filter((item) => item.status === 'UA').map((item) => item.path.replace(/\\/g, '/'));
  const oursPath = oursCandidates.find((candidate) => entries.some((entry) => entry.stage === 2 && entry.path === candidate));
  const theirsPath = theirsCandidates.find((candidate) => entries.some((entry) => entry.stage === 3 && entry.path === candidate));
  return oursPath && theirsPath ? { type: 'rename/rename', basePath: normalized, oursPath, theirsPath } : undefined;
}
