// ── 知识图谱共享类型 ──

export interface GraphNode {
  id: string;
  label: string;
  degree: number;
  /** 节点来源：manual=手动添加, extracted=AI抽取 */
  source: 'manual' | 'extracted' | 'wiki-link';
  /** 实体分类（extracted 时有效） */
  category?: string;
  /** 抽取置信度 0-1（extracted 时有效） */
  confidence?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  kind?: 'co-occurrence' | 'inferred' | 'wiki-link';
  sourcePath?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── AI 抽取相关类型 ──

export type ExtractStrategy = 'keyword' | 'entity' | 'concept-relation';

export interface ExtractedEntity {
  name: string;
  category: string;
  aliases?: string[];
  relevance: number;
  context?: string;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  label: string;
}

export interface ExtractResult {
  entities: ExtractedEntity[];
  relations?: ExtractedRelation[];
}

export interface ExtractOptions {
  strategy: ExtractStrategy;
  maxEntities?: number;
  customPrompt?: string;
}
