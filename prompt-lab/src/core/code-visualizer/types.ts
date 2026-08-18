export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface SourceLocation {
  file: string;
  line: number;
  endLine?: number;
  snippet?: string;
}

export interface AnalysisNode {
  id: string;
  kind: 'frontend' | 'endpoint' | 'controller' | 'service' | 'repository' | 'model' | 'database';
  label: string;
  detail?: string;
  location?: SourceLocation;
}

export interface AnalysisEdge {
  source: string;
  target: string;
  kind: 'requests' | 'handles' | 'calls' | 'reads' | 'writes' | 'maps-to';
  confidence: 'exact' | 'inferred';
  evidence?: string;
}

export interface FrontendCall {
  id: string;
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  location: SourceLocation;
  confidence?: 'exact' | 'inferred';
  evidence?: string;
}

export interface AnalyzerReport {
  id: string;
  language: 'python' | 'typescript' | 'javascript' | 'vue';
  engine: 'ast' | 'semantic' | 'regex-fallback';
  files: number;
  artifacts: number;
  failures: Array<{ file: string; message: string }>;
}

export interface GitRepositoryInfo {
  available: boolean;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  changedFiles: string[];
}

export interface RuntimeEndpointMetric {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
}

export interface ApiParameter {
  name: string;
  source: 'path' | 'query' | 'header' | 'cookie' | 'body';
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface ApiContract {
  parameters: ApiParameter[];
  requestModel?: string;
  responseModel?: string;
  statusCodes: number[];
}

export interface DatabaseField {
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  defaultValue?: string;
  foreignKey?: string;
  location?: SourceLocation;
}

export interface DatabaseTable {
  name: string;
  model?: string;
  fields: DatabaseField[];
  location?: SourceLocation;
}

export interface DatabaseRelation {
  sourceTable: string;
  sourceField: string;
  targetTable: string;
  targetField: string;
  kind: 'many-to-one' | 'one-to-one' | 'many-to-many';
}

export interface DataFlowStep {
  id: string;
  stage: 'frontend' | 'parameter' | 'model' | 'handler' | 'function' | 'field';
  label: string;
  detail?: string;
  location?: SourceLocation;
}

export interface TestReference {
  file: string;
  line: number;
  kind: 'backend' | 'frontend' | 'e2e';
  evidence: string;
  testName?: string;
  confidence?: 'direct' | 'text-match';
}

export interface PerformanceRisk {
  id: string;
  rule: 'query-in-loop' | 'external-call-in-loop' | 'unbounded-query' | 'unbounded-sql' | 'blocking-in-async' | 'sync-db-in-async' | 'deep-call-chain' | 'duplicate-table-read';
  severity: 'warning' | 'error';
  message: string;
  location: SourceLocation;
}

export interface AnalysisDiagnostic {
  id: string;
  kind: 'unused-endpoint' | 'missing-backend' | 'method-mismatch' | 'dynamic-url';
  severity: 'info' | 'warning' | 'error';
  message: string;
  endpointId?: string;
  frontendCall?: FrontendCall;
  location: SourceLocation;
}

export interface ApiEndpoint {
  id: string;
  framework: 'fastapi' | 'flask' | 'django' | 'drf';
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  handler: string;
  location: SourceLocation;
  frontendCalls: FrontendCall[];
  tables: string[];
  databaseTables: DatabaseTable[];
  dataFlow: DataFlowStep[];
  tests: TestReference[];
  performanceRisks: PerformanceRisk[];
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  contract: ApiContract;
  diagnostics: AnalysisDiagnostic[];
}

export interface RepositoryAnalysis {
  rootPath: string;
  scannedAt: number;
  filesScanned: number;
  pythonFiles: number;
  vueFiles: number;
  endpoints: ApiEndpoint[];
  frontendCalls?: FrontendCall[];
  diagnostics?: AnalysisDiagnostic[];
  databaseTables?: DatabaseTable[];
  databaseRelations?: DatabaseRelation[];
  globalGraph?: { nodes: AnalysisNode[]; edges: AnalysisEdge[] };
  scan?: {
    mode: 'full' | 'incremental';
    changedFiles: number;
    reusedFiles: number;
    removedFiles: number;
    durationMs: number;
    snapshotId?: string;
    complete?: boolean;
    skippedFiles?: number;
    analyzerReports?: AnalyzerReport[];
  };
  git?: GitRepositoryInfo;
  runtimeMetrics?: RuntimeEndpointMetric[];
  warnings: string[];
}

export interface CodeVisualizerScanSnapshot {
  id: string;
  rootPath: string;
  scannedAt: number;
  endpointCount: number;
  diagnosticCount: number;
  changedFiles: number;
  mode: 'full' | 'incremental';
}

export interface CodeVisualizerSnapshotDiff {
  fromId: string;
  toId: string;
  addedEndpoints: string[];
  removedEndpoints: string[];
  changedContracts: string[];
  addedTables: string[];
  removedTables: string[];
  addedFields: string[];
  removedFields: string[];
  diagnosticDelta: number;
}

export interface CodeVisualizerProjectHistory {
  rootPath: string;
  name: string;
  lastScannedAt: number;
  endpointCount: number;
  pythonFiles: number;
  vueFiles: number;
  available: boolean;
}

export interface RepositorySourceFile {
  path: string;
  content: string;
}
