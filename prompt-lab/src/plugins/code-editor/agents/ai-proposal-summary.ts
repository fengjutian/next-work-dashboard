import type { AiFileProposal } from './useAiSessionState';

export type AiProposalKind = 'create' | 'modify' | 'delete' | 'rename';

export function summarizeAiProposal(proposal: AiFileProposal): { kind: AiProposalKind; additions: number; deletions: number } {
  const kind: AiProposalKind = proposal.previousPath
    ? 'rename'
    : proposal.original === ''
      ? 'create'
      : proposal.modified === ''
        ? 'delete'
        : 'modify';
  const original = proposal.original ? proposal.original.split('\n') : [];
  const modified = proposal.modified ? proposal.modified.split('\n') : [];
  const originalCounts = new Map<string, number>();
  const modifiedCounts = new Map<string, number>();
  for (const line of original) originalCounts.set(line, (originalCounts.get(line) ?? 0) + 1);
  for (const line of modified) modifiedCounts.set(line, (modifiedCounts.get(line) ?? 0) + 1);
  let deletions = 0;
  let additions = 0;
  for (const [line, count] of originalCounts) deletions += Math.max(0, count - (modifiedCounts.get(line) ?? 0));
  for (const [line, count] of modifiedCounts) additions += Math.max(0, count - (originalCounts.get(line) ?? 0));
  return { kind, additions, deletions };
}

