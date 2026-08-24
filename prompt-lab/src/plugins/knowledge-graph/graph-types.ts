// ── 知识图谱共享类型 ──

export interface GraphNode {
  id: string;
  label: string;
  degree: number;
  /** 节点来源：manual=手动添加, extracted=AI抽取 */
  source: 'manual' | 'extracted' | 'wiki-link' | 'code';
  /** 实体分类（extracted 时有效） */
  category?: string;
  /** 抽取置信度 0-1（extracted 时有效） */
  confidence?: number;
  /** 代码节点所在的工作区相对路径。 */
  sourcePath?: string;
  aliases?: string[];
  canonicalName?: string;
  metrics?: GraphNodeMetrics;
}

export interface GraphNodeMetrics {
  churn?: number;
  lastModifiedAt?: number;
  blastRadius?: number;
  inDegree?: number;
  outDegree?: number;
  authors?: Array<{ name: string; commits: number }>;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  kind?: 'co-occurrence' | 'inferred' | 'wiki-link' | 'code';
  sourcePath?: string;
  /** AI 抽取出的关系名称，例如“依赖”“调用” */
  label?: string;
  /** Candidate facts are reviewed before they enter the persisted graph. */
  status?: 'candidate' | 'accepted' | 'rejected' | 'stale';
  confidence?: number;
  evidence?: GraphEvidence[];
  extractionModel?: string;
  extractedAt?: number;
  resolution?: 'exact' | 'heuristic' | 'unresolved';
}

export interface GraphEvidence {
  documentName: string;
  sourcePath?: string;
  quote?: string;
  line?: number;
  page?: number;
  documentHash?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  documents?: GraphDocumentSnapshot[];
}

export type ImpactDirection = 'upstream' | 'downstream' | 'both';
export interface GraphPath { nodeIds: string[]; edgeIndexes: number[] }
export interface ImpactAnalysis {
  centerId: string;
  direction: ImpactDirection;
  direct: GraphNode[];
  transitive: GraphNode[];
  paths: GraphPath[];
  depthByNode: Record<string, number>;
  cycles: string[][];
  score: number;
}
export interface GraphFinding {
  id: string;
  kind: 'cycle' | 'orphan' | 'hub' | 'high-coupling' | 'stale-evidence' | 'unsupported-claim' | 'schema-violation';
  severity: 'info' | 'warning' | 'error';
  nodeIds: string[];
  edgeIndexes?: number[];
  explanation: string;
  suggestedAction?: string;
}
export interface GraphHealthReport { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; findings: GraphFinding[] }
export interface GraphSnapshot { id: string; createdAt: number; label?: string; graph: GraphData }
export interface GraphDiff {
  addedNodeIds: string[]; removedNodeIds: string[]; changedNodeIds: string[];
  addedEdges: GraphEdge[]; removedEdges: GraphEdge[]; affectedNodeIds: string[];
}

export interface GraphDocumentSnapshot {
  path: string;
  name: string;
  hash: string;
  indexedAt: number;
  active: boolean;
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
  confidence?: number;
  evidence?: GraphEvidence[];
  extractionModel?: string;
  extractedAt?: number;
}

export interface ExtractionDocument { name: string; content: string; sourcePath?: string }

export interface GraphSchema {
  id: string;
  name: string;
  description: string;
  nodeTypes: string[];
  relationTypes: Array<{ name: string; from: string[]; to: string[] }>;
}

export interface ExtractResult {
  entities: ExtractedEntity[];
  relations?: ExtractedRelation[];
}

export interface ExtractOptions {
  strategy: ExtractStrategy;
  maxEntities?: number;
  customPrompt?: string;
  schema?: GraphSchema;
}
