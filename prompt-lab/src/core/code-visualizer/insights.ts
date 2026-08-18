import type { AnalysisEdge, ArchitectureFinding, ArchitectureHealthReport, DatabaseAnalysisReport, RepositoryAnalysis, RepositorySourceFile, SmartInsight, SqlQueryArtifact } from './types';

export function analyzeArchitectureHealth(result: RepositoryAnalysis): ArchitectureHealthReport {
  const graph = result.globalGraph ?? { nodes: result.endpoints.flatMap((endpoint) => endpoint.nodes), edges: result.endpoints.flatMap((endpoint) => endpoint.edges) };
  const findings: ArchitectureFinding[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = groupEdges(graph.edges);
  const cycles = findCycles(outgoing);
  for (const cycle of cycles) findings.push({ id: `arch:cycle:${cycle.join(':')}`, rule: 'cycle', severity: 'error', message: `发现循环依赖：${cycle.map((id) => nodeById.get(id)?.label ?? id).join(' → ')}`, nodes: cycle, location: nodeById.get(cycle[0])?.location });
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
    if (source?.kind === 'controller' && target?.kind === 'database') findings.push({ id: `arch:layer:${edge.source}:${edge.target}`, rule: 'layer-violation', severity: 'warning', message: `${source.label} 直接访问数据库 ${target.label}`, nodes: [edge.source, edge.target], location: source.location });
  }
  for (const [source, edges] of outgoing) if (edges.length >= 8) findings.push({ id: `arch:fanout:${source}`, rule: 'high-fan-out', severity: 'warning', message: `${nodeById.get(source)?.label ?? source} 依赖 ${edges.length} 个下游节点`, nodes: [source], location: nodeById.get(source)?.location });
  const routeGroups = new Map<string, typeof result.endpoints>();
  for (const endpoint of result.endpoints) { const key = `${endpoint.method}:${endpoint.normalizedPath}`; routeGroups.set(key, [...(routeGroups.get(key) ?? []), endpoint]); }
  for (const [route, endpoints] of routeGroups) if (endpoints.length > 1) findings.push({ id: `arch:route:${route}`, rule: 'duplicate-route', severity: 'error', message: `重复路由 ${route.replace(':', ' ')}`, nodes: endpoints.map((endpoint) => endpoint.id), location: endpoints[0].location });
  const tableUsage = new Map<string, string[]>();
  for (const endpoint of result.endpoints) for (const table of endpoint.tables) tableUsage.set(table, [...(tableUsage.get(table) ?? []), endpoint.id]);
  for (const [table, endpoints] of tableUsage) if (endpoints.length >= 5) findings.push({ id: `arch:shared:${table}`, rule: 'shared-database', severity: 'warning', message: `${table} 被 ${endpoints.length} 个接口共享访问`, nodes: endpoints });
  const maxDepth = Math.max(0, ...result.endpoints.map((endpoint) => graphDepth(endpoint.edges)));
  if (maxDepth > 8) findings.push({ id: 'arch:depth', rule: 'deep-chain', severity: 'warning', message: `最大调用深度达到 ${maxDepth}`, nodes: [] });
  return { score: Math.max(0, 100 - findings.reduce((sum, finding) => sum + (finding.severity === 'error' ? 15 : 7), 0)), findings, metrics: { nodes: nodeById.size, edges: graph.edges.length, maxDepth, sharedTables: [...tableUsage.values()].filter((items) => items.length >= 5).length } };
}

export function analyzeDatabaseQueries(result: RepositoryAnalysis, files: RepositorySourceFile[]): DatabaseAnalysisReport {
  const queries: SqlQueryArtifact[] = [];
  for (const file of files) for (const match of file.content.matchAll(/(["'`]{1,3})(\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[\s\S]{3,2000}?)\1/gi)) {
    const sql = match[2].trim(); const operation = (/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.exec(sql)?.[1].toUpperCase() ?? 'UNKNOWN') as SqlQueryArtifact['operation'];
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([\w."`]+)/gi)].map((item) => item[1].replace(/["`]/g, ''));
    const line = file.content.slice(0, match.index).split('\n').length;
    const endpointIds = result.endpoints.filter((endpoint) => endpoint.nodes.some((node) => node.location?.file === file.path && line >= node.location.line && line <= (node.location.endLine ?? node.location.line))).map((endpoint) => endpoint.id);
    const risks: SqlQueryArtifact['risks'] = [];
    if (/^SELECT\s+\*/i.test(sql)) risks.push('select-star');
    if (/^(?:UPDATE|DELETE)\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) risks.push('missing-where');
    if (/^SELECT\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) risks.push('unbounded-select');
    if (/\$\{|\{\}|%s|\.format\s*\(/.test(sql)) risks.push('dynamic-sql');
    queries.push({ id: `sql:${file.path}:${line}`, operation, sql, tables, location: { file: file.path, line, snippet: sql.slice(0, 240) }, endpointIds, risks });
  }
  const tableToEndpoints: Record<string, string[]> = {};
  for (const endpoint of result.endpoints) for (const table of endpoint.tables) tableToEndpoints[table] = [...new Set([...(tableToEndpoints[table] ?? []), endpoint.id])];
  for (const query of queries) for (const table of query.tables) tableToEndpoints[table] = [...new Set([...(tableToEndpoints[table] ?? []), ...query.endpointIds])];
  return { queries, tableToEndpoints, riskCount: queries.reduce((sum, query) => sum + query.risks.length, 0) };
}

export function buildSmartInsights(result: RepositoryAnalysis): SmartInsight[] {
  const insights: SmartInsight[] = [];
  for (const finding of result.architectureHealth?.findings ?? []) insights.push({ id: `smart:${finding.id}`, severity: finding.severity, title: `架构：${finding.rule}`, summary: finding.message, recommendation: finding.rule === 'cycle' ? '提取稳定接口或引入依赖倒置，打断循环方向。' : finding.rule === 'layer-violation' ? '将数据库访问移动到 Repository/Service 层。' : '拆分职责并为依赖建立明确边界。', location: finding.location });
  for (const query of result.databaseAnalysis?.queries.filter((item) => item.risks.length) ?? []) insights.push({ id: `smart:${query.id}`, severity: query.risks.includes('missing-where') ? 'error' : 'warning', title: `查询风险：${query.operation}`, summary: query.risks.join('、'), recommendation: query.risks.includes('missing-where') ? '执行前增加精确 WHERE 条件和受影响行数保护。' : '限制返回列和结果数量，并使用参数化查询。', endpointId: query.endpointIds[0], location: query.location });
  for (const failure of result.qualityGate?.failures ?? []) insights.push({ id: `smart:quality:${failure.rule}:${failure.endpoint}`, severity: failure.rule === 'breaking-contract' ? 'error' : 'warning', title: `质量门禁：${failure.rule}`, summary: failure.message, recommendation: failure.rule === 'missing-test' ? '为正常、异常和鉴权路径增加自动化测试。' : '修复差异或记录有期限的治理豁免。' });
  return insights;
}

function groupEdges(edges: AnalysisEdge[]): Map<string, AnalysisEdge[]> { const result = new Map<string, AnalysisEdge[]>(); for (const edge of edges.filter((item) => item.kind === 'calls' || item.kind === 'handles')) result.set(edge.source, [...(result.get(edge.source) ?? []), edge]); return result; }
function findCycles(outgoing: Map<string, AnalysisEdge[]>): string[][] { const cycles: string[][] = []; const visiting = new Set<string>(); const visited = new Set<string>(); const walk = (node: string, path: string[]): void => { if (visiting.has(node)) { cycles.push(path.slice(path.indexOf(node))); return; } if (visited.has(node)) return; visiting.add(node); for (const edge of outgoing.get(node) ?? []) walk(edge.target, [...path, edge.target]); visiting.delete(node); visited.add(node); }; for (const node of outgoing.keys()) walk(node, [node]); return cycles.slice(0, 20); }
function graphDepth(edges: AnalysisEdge[]): number { const outgoing = groupEdges(edges); const walk = (node: string, seen: Set<string>): number => seen.has(node) ? 0 : 1 + Math.max(0, ...(outgoing.get(node) ?? []).map((edge) => walk(edge.target, new Set(seen).add(node)))); return Math.max(0, ...outgoing.keys().map((node) => walk(node, new Set()))); }
