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
  scan?: {
    mode: 'full' | 'incremental';
    changedFiles: number;
    reusedFiles: number;
    removedFiles: number;
    durationMs: number;
    snapshotId?: string;
  };
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
