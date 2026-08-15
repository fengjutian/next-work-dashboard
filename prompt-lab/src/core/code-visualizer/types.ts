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
}

export interface RepositoryAnalysis {
  rootPath: string;
  scannedAt: number;
  filesScanned: number;
  pythonFiles: number;
  vueFiles: number;
  endpoints: ApiEndpoint[];
  warnings: string[];
}

export interface RepositorySourceFile {
  path: string;
  content: string;
}
