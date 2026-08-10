import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../src/plugins/document-knowledge/chunking';
import { buildRagContext, cosineSimilarity, prepareRetrievalHits, retrieve } from '../src/plugins/document-knowledge/retrieval';
import { createHashEmbeddings } from '../src/plugins/document-knowledge/hash-embedding';
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

  it('creates stable local vectors without a model runtime', () => {
    const [query, related, unrelated] = createHashEmbeddings(['安装依赖', '项目安装依赖说明', '财务报表']);
    expect(query).toHaveLength(512);
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
    expect(createHashEmbeddings(['安装依赖'])[0]).toEqual(query);
  });

  it('deduplicates content and diversifies results across documents', () => {
    const hits = [
      { id: 'a:0', documentId: 'a', documentName: 'a.md', sectionId: 's', sectionTitle: 'A', content: '相同的退款说明', vector: [1], score: .9, chunkIndex: 0 },
      { id: 'a:2', documentId: 'a', documentName: 'a.md', sectionId: 'x', sectionTitle: 'A2', content: '另一段退款内容', vector: [1], score: .8, chunkIndex: 2 },
      { id: 'b:0', documentId: 'b', documentName: 'b.md', sectionId: 's', sectionTitle: 'B', content: '相同的退款说明', vector: [1], score: .7, chunkIndex: 0 },
      { id: 'c:0', documentId: 'c', documentName: 'c.md', sectionId: 's', sectionTitle: 'C', content: '独立售后政策', vector: [1], score: .6, chunkIndex: 0 },
    ];
    const prepared = prepareRetrievalHits(hits, { limit: 3, maxPerDocument: 1 });
    expect(prepared.map((hit) => hit.documentId)).toEqual(['a', 'c']);
  });

  it('merges adjacent chunks, removes overlap, and respects the context budget', () => {
    const overlap = '这是需要去除的重叠文本内容二十个字符以上';
    const hits = [
      { id: 'doc:s:0', documentId: 'doc', documentName: 'manual.md', sectionId: 's', sectionTitle: '退款', content: `第一部分${overlap}`, vector: [1], score: .9, chunkIndex: 0 },
      { id: 'doc:s:1', documentId: 'doc', documentName: 'manual.md', sectionId: 's', sectionTitle: '退款', content: `${overlap}${'后续说明'.repeat(100)}`, vector: [1], score: .8, chunkIndex: 1 },
    ];
    const [merged] = prepareRetrievalHits(hits, { limit: 3, maxPerDocument: 3, contextBudget: 300 });
    expect(merged.mergedChunkIds).toEqual(['doc:s:0', 'doc:s:1']);
    expect(merged.content.match(new RegExp(overlap, 'g'))).toHaveLength(1);
    expect(merged.content).toContain('[片段已截断]');
    expect(buildRagContext([merged]).length).toBeLessThan(450);
  });
});
