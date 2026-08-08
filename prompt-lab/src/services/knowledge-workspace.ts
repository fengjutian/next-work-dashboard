import {
  createKnowledgeProposal,
  analyzeKnowledgeUpdateImpact,
  evaluateKnowledgeHealth,
  rejectKnowledgeProposal,
  type KnowledgeChangeProposal,
  type KnowledgeIndex,
  type KnowledgeMutation,
  type KnowledgeSearchFilters,
  type KnowledgeSearchHit,
  type KnowledgeUpdateImpact,
  type KnowledgeDiagnostic,
  type KnowledgeHealthReport,
} from '@/core/knowledge';
import type { WorkspaceFileMutation } from '@/types/electron';

const ACTIVE_ROOT_KEY = 'knowledge-workspace.active-root';

function storedRoot(): string | null {
  try { return localStorage.getItem(ACTIVE_ROOT_KEY); } catch { return null; }
}

class ActiveKnowledgeWorkspaceService {
  private rootPath: string | null = storedRoot();
  private index: (KnowledgeIndex & { diagnostics?: KnowledgeDiagnostic[] }) | null = null;
  private proposals: KnowledgeChangeProposal[] = [];
  private listeners = new Set<(proposals: KnowledgeChangeProposal[]) => void>();

  get activeRoot(): string | null { return this.rootPath; }
  get documents(): KnowledgeIndex['documents'] { return this.index?.documents ?? []; }

  setActive(rootPath: string, index?: KnowledgeIndex & { diagnostics?: KnowledgeDiagnostic[] }): void {
    this.rootPath = rootPath;
    this.index = index ?? null;
    try { localStorage.setItem(ACTIVE_ROOT_KEY, rootPath); } catch { /* storage is optional */ }
  }

  clear(): void {
    this.rootPath = null;
    this.index = null;
    try { localStorage.removeItem(ACTIVE_ROOT_KEY); } catch { /* storage is optional */ }
  }

  get changeProposals(): KnowledgeChangeProposal[] { return this.proposals; }

  subscribe(listener: (proposals: KnowledgeChangeProposal[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.proposals);
    return () => this.listeners.delete(listener);
  }

  private emit(): void { this.listeners.forEach((listener) => listener(this.proposals)); }

  propose(instruction: string, mutations: KnowledgeMutation[]): KnowledgeChangeProposal {
    const proposal = createKnowledgeProposal(instruction, mutations);
    this.proposals = [...this.proposals, proposal].slice(-50);
    this.emit();
    return proposal;
  }

  rejectProposal(id: string): void {
    this.proposals = this.proposals.map((proposal) => proposal.id === id ? rejectKnowledgeProposal(proposal) : proposal);
    this.emit();
  }

  async acceptProposal(id: string): Promise<KnowledgeChangeProposal> {
    const root = await this.authorize();
    const proposal = this.proposals.find((item) => item.id === id);
    if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
    if (proposal.status !== 'ready-for-review' && proposal.status !== 'partially-accepted') throw new Error(`PROPOSAL_NOT_REVIEWABLE:${proposal.status}`);
    const mutations: WorkspaceFileMutation[] = proposal.mutations.map((mutation) => {
      if (mutation.kind === 'create') return { kind: 'create', path: mutation.path, content: mutation.content };
      if (mutation.kind === 'delete') return { kind: 'delete', path: mutation.path, expectedModifiedAt: mutation.expectedModifiedAt };
      if (mutation.kind === 'rename') return {
        kind: 'rename', path: mutation.path, targetPath: mutation.targetPath,
        content: mutation.content, expectedModifiedAt: mutation.expectedModifiedAt,
      };
      return { kind: 'write', path: mutation.path, content: mutation.content, expectedModifiedAt: mutation.expectedModifiedAt };
    });
    const result = await window.electronAPI.workspace.mutateFiles(root, mutations);
    const status: KnowledgeChangeProposal['status'] = result.success ? 'accepted' : 'conflicted';
    this.proposals = this.proposals.map((item) => item.id === id ? { ...item, status } : item);
    this.emit();
    if (!result.success) throw new Error(result.error ?? 'KNOWLEDGE_CHANGE_APPLY_FAILED');
    const changedKnowledgePaths = proposal.mutations.flatMap((mutation) => {
      if (mutation.kind === 'delete') return [];
      return [mutation.kind === 'rename' ? mutation.targetPath : mutation.path];
    });
    if (changedKnowledgePaths.length) {
      const baseline = await window.electronAPI.knowledge.captureState(root, changedKnowledgePaths);
      if (!baseline.success) console.warn('[KnowledgeWorkspace] baseline refresh failed after an accepted write', baseline.error);
    }
    await this.refresh();
    return this.proposals.find((item) => item.id === id)!;
  }

  private async authorize(): Promise<string> {
    if (!this.rootPath) throw new Error('KNOWLEDGE_WORKSPACE_NOT_OPEN');
    const result = await window.electronAPI.workspace.reauthorize(this.rootPath);
    if (!result.success) throw new Error('KNOWLEDGE_WORKSPACE_ACCESS_DENIED');
    return this.rootPath;
  }

  async refresh(): Promise<KnowledgeIndex & { diagnostics?: KnowledgeDiagnostic[] }> {
    const root = await this.authorize();
    const result = await window.electronAPI.knowledge.scanWorkspace(root);
    if (!result.success || !result.data) throw new Error(result.error ?? 'KNOWLEDGE_SCAN_FAILED');
    this.index = result.data;
    return result.data;
  }

  async search(query: string, limit = 10, filters?: KnowledgeSearchFilters): Promise<KnowledgeSearchHit[]> {
    const root = await this.authorize();
    const result = await window.electronAPI.knowledge.searchWorkspace(root, query, limit, filters);
    if (!result.success) throw new Error(result.error ?? 'KNOWLEDGE_SEARCH_FAILED');
    return result.data ?? [];
  }

  async read(path: string): Promise<{ content: string; modifiedAt: number }> {
    const root = await this.authorize();
    const result = await window.electronAPI.knowledge.readDocument(root, path);
    if (!result.success || !result.data) throw new Error(result.error ?? 'KNOWLEDGE_READ_FAILED');
    return result.data;
  }

  async updateImpact(): Promise<KnowledgeUpdateImpact[]> {
    const root = await this.authorize();
    const [index, status] = await Promise.all([
      this.index ? Promise.resolve(this.index) : this.refresh(),
      window.electronAPI.workspace.gitStatus(root),
    ]);
    if (!status.success) throw new Error(status.error ?? 'GIT_STATUS_FAILED');
    return analyzeKnowledgeUpdateImpact(index.documents, status.data ?? []);
  }

  async health(): Promise<KnowledgeHealthReport> {
    const index = this.index ?? await this.refresh();
    return evaluateKnowledgeHealth(index, index.diagnostics ?? []);
  }

  async backlinks(pathOrUri: string): Promise<Array<{ sourceUri: string; sourcePath?: string; sourceTitle?: string; line: number; target: string }>> {
    const index = this.index ?? await this.refresh();
    const document = index.documents.find((item) => item.uri === pathOrUri || item.path === pathOrUri);
    if (!document) throw new Error('KNOWLEDGE_DOCUMENT_NOT_FOUND');
    return (index.backlinks[document.uri] ?? []).map((link) => {
      const source = index.documents.find((item) => item.uri === link.sourceUri);
      return { sourceUri: link.sourceUri, sourcePath: source?.path, sourceTitle: source?.title, line: link.line, target: link.target };
    });
  }
}

export const activeKnowledgeWorkspace = new ActiveKnowledgeWorkspaceService();
