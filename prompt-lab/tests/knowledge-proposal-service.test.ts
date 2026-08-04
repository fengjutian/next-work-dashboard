import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeKnowledgeWorkspace } from '../src/services/knowledge-workspace';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installApi(mutationResult: { success: boolean; error?: string }) {
  const mutateFiles = vi.fn().mockResolvedValue(mutationResult);
  vi.stubGlobal('window', { electronAPI: {
    workspace: { reauthorize: vi.fn().mockResolvedValue({ success: true }), mutateFiles },
    knowledge: { scanWorkspace: vi.fn().mockResolvedValue({ success: true, data: { documents: [], links: [], backlinks: {}, orphanUris: [], skipped: [], templates: [], rules: [], diagnostics: [] } }) },
  } });
  return mutateFiles;
}

describe('knowledge proposal review service', () => {
  it('only writes after acceptance and keeps optimistic-lock metadata', async () => {
    const mutateFiles = installApi({ success: true });
    activeKnowledgeWorkspace.setActive('D:\\knowledge');
    const proposal = activeKnowledgeWorkspace.propose('Update', [{
      kind: 'write', path: 'note.md', before: 'before', content: 'after', expectedModifiedAt: 12,
    }]);
    expect(mutateFiles).not.toHaveBeenCalled();
    const accepted = await activeKnowledgeWorkspace.acceptProposal(proposal.id);
    expect(accepted.status).toBe('accepted');
    expect(mutateFiles).toHaveBeenCalledWith('D:\\knowledge', [{
      kind: 'write', path: 'note.md', content: 'after', expectedModifiedAt: 12,
    }]);
  });

  it('marks a failed atomic write as conflicted', async () => {
    installApi({ success: false, error: 'FILE_MODIFIED_EXTERNALLY:note.md' });
    activeKnowledgeWorkspace.setActive('D:\\knowledge');
    const proposal = activeKnowledgeWorkspace.propose('Update conflict', [{
      kind: 'write', path: 'note.md', before: 'before', content: 'after', expectedModifiedAt: 12,
    }]);
    await expect(activeKnowledgeWorkspace.acceptProposal(proposal.id)).rejects.toThrow('FILE_MODIFIED_EXTERNALLY');
    expect(activeKnowledgeWorkspace.changeProposals.find((item) => item.id === proposal.id)?.status).toBe('conflicted');
  });
});
