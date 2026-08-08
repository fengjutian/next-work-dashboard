import { describe, expect, it } from 'vitest';
import { constrainExtractResult } from '../src/core/graph-extractor';
import { GRAPH_SCHEMAS } from '../src/plugins/knowledge-graph/graph-schemas';

describe('knowledge graph schema', () => {
  it('keeps only schema-compliant entities and evidenced relations', () => {
    const schema = GRAPH_SCHEMAS.find((item) => item.id === 'software');
    expect(schema).toBeDefined();
    if (!schema) return;
    const result = constrainExtractResult({
      entities: [
        { name: '搜索模块', category: '模块', relevance: .9 },
        { name: 'LanceDB', category: '数据库', relevance: .9 },
        { name: '未知对象', category: '其他', relevance: .8 },
      ],
      relations: [
        { source: '搜索模块', target: 'LanceDB', label: '读写', confidence: .92, extractionModel: 'test-model', extractedAt: 123, evidence: [{ documentName: 'design.md', sourcePath: 'docs/design.md', quote: '搜索模块读写 LanceDB。' }] },
        { source: '搜索模块', target: 'LanceDB', label: '创造', evidence: [{ documentName: 'design.md', quote: '无效关系。' }] },
        { source: '搜索模块', target: 'LanceDB', label: '读写' },
      ],
    }, schema);
    expect(result.entities.map((entity) => entity.name)).toEqual(['搜索模块', 'LanceDB']);
    expect(result.relations).toHaveLength(1);
    expect(result.relations?.[0].label).toBe('读写');
    expect(result.relations?.[0].evidence?.[0].sourcePath).toBe('docs/design.md');
    expect(result.relations?.[0].extractionModel).toBe('test-model');
  });
});
