import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../src/plugins/document-knowledge/chunking';
import { buildRagContext, cosineSimilarity, retrieve } from '../src/plugins/document-knowledge/retrieval';
import type { DocumentChunk, ParsedDocument } from '../src/plugins/document-knowledge/types';

const document: ParsedDocument = {
  id: 'doc-1', name: 'manual.pdf', kind: 'pdf', size: 100, createdAt: 1,
  plainText: '',
  sections: [{ id: 'page-1', title: '安装', page: 1, content: '第一步安装依赖。\n'.repeat(100) }],
};

describe('document knowledge pipeline', () => {
  it('splits structured sections while retaining source metadata', () => {
    const chunks = chunkDocument(document, { maxChars: 240, overlapChars: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ documentId: 'doc-1', sectionTitle: '安装', page: 1 });
    expect(chunks.every((chunk) => chunk.content.length <= 240)).toBe(true);
  });

  it('ranks vectors by cosine similarity and builds cited context', () => {
    const chunks: DocumentChunk[] = [
      { id: 'a', documentId: 'doc-1', documentName: 'manual.pdf', sectionId: '1', sectionTitle: '安装', page: 1, content: '安装说明', vector: [1, 0] },
      { id: 'b', documentId: 'doc-1', documentName: 'manual.pdf', sectionId: '2', sectionTitle: '卸载', page: 2, content: '卸载说明', vector: [0, 1] },
    ];
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    const hits = retrieve(chunks, [0.9, 0.1], 1);
    expect(hits[0].id).toBe('a');
    expect(buildRagContext(hits)).toContain('[资料 1] manual.pdf / 安装 / 第 1 页');
  });
});
