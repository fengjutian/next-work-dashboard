import type { KnowledgeChangeProposal, KnowledgeMutation } from './types';

export function createKnowledgeProposal(instruction: string, mutations: KnowledgeMutation[], now = Date.now()): KnowledgeChangeProposal {
  if (!instruction.trim()) throw new Error('INSTRUCTION_REQUIRED');
  if (!mutations.length) throw new Error('MUTATIONS_REQUIRED');
  const seen = new Set<string>();
  for (const mutation of mutations) {
    const key = mutation.path.replace(/\\/g, '/').toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`DUPLICATE_MUTATION_PATH:${mutation.path}`);
    seen.add(key);
  }
  return { id: `knowledge-change-${now}`, instruction: instruction.trim(), createdAt: now, status: 'ready-for-review', mutations };
}

export function rejectKnowledgeProposal(proposal: KnowledgeChangeProposal): KnowledgeChangeProposal {
  if (proposal.status === 'accepted') throw new Error('PROPOSAL_ALREADY_ACCEPTED');
  return { ...proposal, status: 'rejected' };
}
