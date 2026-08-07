export type DocumentKind = 'pdf' | 'word' | 'excel' | 'powerpoint';

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  page?: number;
}

export interface ParsedDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  size: number;
  sections: DocumentSection[];
  plainText: string;
  previewUrl?: string;
  createdAt: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentName: string;
  sectionId: string;
  sectionTitle: string;
  page?: number;
  content: string;
  vector: number[];
}

export interface RetrievalHit extends DocumentChunk {
  score: number;
}

export interface RagMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: RetrievalHit[];
}
