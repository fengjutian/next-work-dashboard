import type { AnalysisDiagnostic, FrontendCall, RepositoryAnalysis } from './types';

export function diagnoseFrontendBackend(result: RepositoryAnalysis, frontendCalls: FrontendCall[]): AnalysisDiagnostic[] {
  const diagnostics: AnalysisDiagnostic[] = [];
  for (const endpoint of result.endpoints) {
    if (endpoint.frontendCalls.length === 0) diagnostics.push({ id: `unused:${endpoint.id}:${endpoint.location.file}`, kind: 'unused-endpoint', severity: 'info', message: `未找到调用 ${endpoint.method} ${endpoint.path} 的前端代码`, endpointId: endpoint.id, location: endpoint.location });
  }
  for (const call of frontendCalls) {
    if (result.endpoints.some((endpoint) => endpoint.method === call.method && endpoint.normalizedPath === call.normalizedPath)) continue;
    const samePath = result.endpoints.filter((endpoint) => endpoint.normalizedPath === call.normalizedPath);
    diagnostics.push({ id: `frontend:${call.id}`, kind: samePath.length ? 'method-mismatch' : 'missing-backend', severity: 'error', message: samePath.length ? `前端使用 ${call.method}，后端该路径提供 ${samePath.map((item) => item.method).join('/')}` : `前端请求 ${call.method} ${call.path} 没有对应后端接口`, frontendCall: call, location: call.location });
  }
  for (const endpoint of result.endpoints) endpoint.diagnostics = diagnostics.filter((item) => item.endpointId === endpoint.id);
  return diagnostics;
}
