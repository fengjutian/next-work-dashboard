export type KnowledgeDocumentType = 'conversation' | 'note' | 'spec' | 'prompt' | 'code' | 'document';

export interface WikiLink {
  raw: string;
  target: string;
  label?: string;
  embedded: boolean;
  line: number;
}

export interface KnowledgeDocument {
  uri: string;
  path: string;
  title: string;
  type: KnowledgeDocumentType;
  tags: string[];
  aliases: string[];
  links: WikiLink[];
  modifiedAt: number;
  contentHash: string;
  frontmatter: Record<string, unknown>;
}

export interface ResolvedKnowledgeLink extends WikiLink {
  sourceUri: string;
  targetUri?: string;
  status: 'resolved' | 'unresolved' | 'ambiguous';
  candidates?: string[];
}

export interface KnowledgeIndex {
  documents: KnowledgeDocument[];
  links: ResolvedKnowledgeLink[];
  backlinks: Record<string, ResolvedKnowledgeLink[]>;
  orphanUris: string[];
}

export interface KnowledgeTemplate {
  id: string;
  name: string;
  directory: string;
  fileName: string;
  content: string;
  defaults?: Record<string, string>;
}

export interface KnowledgeContentRule {
  include: string;
  requiredFrontmatter?: string[];
  requiredSections?: string[];
  allowedTypes?: KnowledgeDocumentType[];
}

export interface KnowledgeDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export type KnowledgeMutation =
  | { kind: 'create'; path: string; content: string }
  | { kind: 'write'; path: string; before: string; content: string; expectedModifiedAt?: number }
  | { kind: 'delete'; path: string; before: string; expectedModifiedAt?: number }
  | { kind: 'rename'; path: string; targetPath: string; before: string; content?: string; expectedModifiedAt?: number };

export interface KnowledgeChangeProposal {
  id: string;
  instruction: string;
  createdAt: number;
  status: 'draft' | 'ready-for-review' | 'partially-accepted' | 'accepted' | 'rejected' | 'conflicted';
  mutations: KnowledgeMutation[];
}
