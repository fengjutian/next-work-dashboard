import { beforeEach, describe, expect, it, vi } from 'vitest';

const tableNames = vi.fn<() => Promise<string[]>>();
const createTable = vi.fn();
const openTable = vi.fn();
const connect = vi.fn(async () => ({ tableNames, createTable, openTable }));

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\test-user-data' } }));
vi.mock('@lancedb/lancedb', () => ({ connect }));

describe('document LanceDB adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableNames.mockResolvedValue([]);
  });

  it('creates a dimension-specific table for vector upserts', async () => {
    const { applyLanceDocumentOperations } = await import('../src/main/lancedb-memory');
    await applyLanceDocumentOperations([{
      id: 1, operation: 'upsert_vector', chunkId: 'chunk-1', documentId: 'doc-1', retryCount: 0,
      payload: { content: 'refund policy', sectionTitle: 'Policy', page: 1, modelId: 'local:test', vector: [1, 0] },
    }]);
    expect(createTable).toHaveBeenCalledWith('document_chunks_2', [expect.objectContaining({
      id: 'chunk-1', documentId: 'doc-1', modelId: 'local:test', vector: [1, 0],
    })]);
  });

  it('deletes document vectors from each document table', async () => {
    const table = { delete: vi.fn(async () => undefined) };
    tableNames.mockResolvedValue(['conversation_chunks', 'document_chunks_2']);
    openTable.mockResolvedValue(table);
    const { applyLanceDocumentOperations } = await import('../src/main/lancedb-memory');
    await applyLanceDocumentOperations([{
      id: 2, operation: 'delete_document', documentId: "doc'1", retryCount: 0, payload: {},
    }]);
    expect(table.delete).toHaveBeenCalledWith("documentId IN ('doc''1')");
  });
});
