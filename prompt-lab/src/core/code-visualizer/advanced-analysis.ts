import type { ArchitectureRuleConfig, ExplainReport, FieldLineageReport, RepositoryAnalysis, RepositorySourceFile, SecurityGovernanceReport, SqlStructure } from './types';

export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureRuleConfig = { maxDepth: 8, maxFanOut: 7, sharedTableThreshold: 5, minimumCoverage: .8, forbidden: [{ from: 'controller', to: 'database' }], ignoredRules: [] };

export function parseArchitectureConfig(input: unknown): ArchitectureRuleConfig {
  const root = record(input); const architecture = record(root.architecture); const coverage = record(root.coverage); const minimum = Number(coverage.minimum ?? 80);
  const forbidden = Array.isArray(architecture.forbidden) ? architecture.forbidden.map(record).filter((item) => typeof item.from === 'string' && typeof item.to === 'string').map((item) => ({ from: item.from as ArchitectureRuleConfig['forbidden'][number]['from'], to: item.to as ArchitectureRuleConfig['forbidden'][number]['to'] })) : DEFAULT_ARCHITECTURE_CONFIG.forbidden;
  return { maxDepth: positive(architecture.maxDepth, 8), maxFanOut: positive(architecture.maxFanOut, 7), sharedTableThreshold: positive(architecture.sharedTableThreshold, 5), minimumCoverage: Math.min(1, minimum > 1 ? minimum / 100 : minimum), forbidden, ignoredRules: Array.isArray(architecture.ignore) ? architecture.ignore.map(String) : [] };
}

export function parseSqlStructure(sql: string): SqlStructure {
  const clean = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
  const operation = (/^(SELECT|INSERT|UPDATE|DELETE)/i.exec(clean)?.[1].toUpperCase() ?? 'UNKNOWN') as SqlStructure['operation'];
  const tableMatches = [...clean.matchAll(/\b(?:FROM|INTO|UPDATE)\s+([\w."`]+)(?:\s+(?:AS\s+)?(\w+))?/gi)];
  const tables = tableMatches.map((item) => unquote(item[1]));
  const joins = [...clean.matchAll(/\bJOIN\s+([\w."`]+)(?:\s+(?:AS\s+)?\w+)?(?:\s+ON\s+(.+?))?(?=\s+(?:LEFT|RIGHT|INNER|OUTER|FULL|JOIN|WHERE|GROUP|ORDER|LIMIT|$))/gi)].map((item) => ({ table: unquote(item[1]), condition: item[2]?.trim() }));
  const select = /(?:^|\)\s*)SELECT\s+(.+?)\s+FROM\b/i.exec(clean)?.[1] ?? '';
  const aliases: Record<string, string> = {}; for (const item of tableMatches) if (item[2] && !/^(?:WHERE|JOIN|LEFT|RIGHT|INNER|ORDER|GROUP|LIMIT|SET)$/i.test(item[2])) aliases[item[2]] = unquote(item[1]);
  for (const join of [...clean.matchAll(/\bJOIN\s+([\w."`]+)(?:\s+(?:AS\s+)?(\w+))?/gi)]) if (join[2]) aliases[join[2]] = unquote(join[1]);
  const selectedColumns = splitColumns(select); const where = /\bWHERE\s+(.+?)(?=\s+(?:GROUP|ORDER|LIMIT|HAVING)\b|$)/i.exec(clean)?.[1] ?? '';
  const filterColumns = [...where.matchAll(/(?:(\w+)\.)?(\w+)\s*(?:=|<>|!=|<|>|<=|>=|LIKE|IN\b|IS\b)/gi)].map((item) => `${item[1] ? `${item[1]}.` : ''}${item[2]}`);
  const groupColumns = splitColumns(/\bGROUP\s+BY\s+(.+?)(?=\s+(?:HAVING|ORDER|LIMIT)\b|$)/i.exec(clean)?.[1] ?? '');
  const orderColumns = splitColumns(/\bORDER\s+BY\s+(.+?)(?=\s+LIMIT\b|$)/i.exec(clean)?.[1] ?? '').map((item) => item.replace(/\s+(?:ASC|DESC)$/i, ''));
  const aggregates = selectedColumns.flatMap((column) => { const match = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(([^)]+)\)(?:\s+(?:AS\s+)?(\w+))?/i.exec(column); return match ? [{ function: match[1].toUpperCase(), argument: match[2].trim(), output: match[3] }] : []; });
  const ctes = [...clean.matchAll(/(?:\bWITH|,)\s*(\w+)\s+AS\s*\(/gi)].map((item) => item[1]);
  return { operation, tables: [...new Set([...tables, ...joins.map((join) => join.table)])], joins, selectedColumns, hasWhere: Boolean(where), hasLimit: /\bLIMIT\b|\bFETCH\s+FIRST\b/i.test(clean), parameters: [...new Set([...clean.matchAll(/(?:\?|\$\d+|:\w+|%s)/g)].map((item) => item[0]))], aliases, filterColumns, groupColumns, orderColumns, aggregates, ctes };
}

export function buildFieldLineage(result: RepositoryAnalysis): FieldLineageReport {
  const edges: FieldLineageReport['edges'] = [];
  for (const query of result.databaseAnalysis?.queries ?? []) {
    const structure = query.structure ?? parseSqlStructure(query.sql); const aliases = structure.aliases ?? {};
    const addReference = (raw: string, operation: 'filter' | 'group' | 'order'): void => { const resolved = resolveField(raw, aliases, structure.tables); edges.push({ id: `lineage:${operation}:${query.id}:${raw}`, endpointIds: query.endpointIds, operation, source: resolved, target: { kind: 'parameter', field: operation }, location: query.location, confidence: resolved.table ? 'exact' : 'inferred' }); };
    for (const rawColumn of structure.selectedColumns) {
      if (rawColumn === '*') continue;
      const aliasMatch = /^(?:(\w+)\.)?([\w*]+)(?:\s+(?:AS\s+)?(\w+))?$/i.exec(rawColumn.trim()); if (!aliasMatch) continue;
      const table = aliasMatch[1] ? aliases[aliasMatch[1]] ?? aliasMatch[1] : structure.tables.length === 1 ? structure.tables[0] : undefined; const field = aliasMatch[2]; const output = aliasMatch[3] ?? field;
      edges.push({ id: `lineage:read:${query.id}:${table}:${field}`, endpointIds: query.endpointIds, operation: 'read', source: { table, field }, target: { kind: 'response', field: output }, location: query.location, confidence: table ? 'exact' : 'inferred' });
    }
    for (const join of structure.joins) for (const condition of join.condition?.matchAll(/(?:(\w+)\.)?(\w+)\s*=\s*(?:(\w+)\.)?(\w+)/g) ?? []) {
      const leftTable = condition[1] ? aliases[condition[1]] ?? condition[1] : undefined; const rightTable = condition[3] ? aliases[condition[3]] ?? condition[3] : undefined;
      edges.push({ id: `lineage:join:${query.id}:${condition.index}`, endpointIds: query.endpointIds, operation: 'join', source: { table: leftTable, field: condition[2] }, target: { kind: 'table', table: rightTable, field: condition[4] }, location: query.location, confidence: leftTable && rightTable ? 'exact' : 'inferred' });
    }
    const insert = /^INSERT\s+INTO\s+[\w."`]+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(query.sql);
    if (insert) { const fields = splitColumns(insert[1]); const values = splitColumns(insert[2]); fields.forEach((field, index) => edges.push({ id: `lineage:write:${query.id}:${field}`, endpointIds: query.endpointIds, operation: 'write', source: { field: values[index] ?? '?' }, target: { kind: 'table', table: structure.tables[0], field: unquote(field.trim()) }, location: query.location, confidence: 'exact' })); }
    const update = /\bSET\s+(.+?)(?:\s+WHERE\b|$)/i.exec(query.sql)?.[1]; if (update) for (const assignment of splitColumns(update)) { const match = /([\w."`]+)\s*=\s*(.+)/.exec(assignment); if (match) edges.push({ id: `lineage:update:${query.id}:${match[1]}`, endpointIds: query.endpointIds, operation: 'write', source: { field: match[2].trim() }, target: { kind: 'table', table: structure.tables[0], field: unquote(match[1]) }, location: query.location, confidence: 'exact' }); }
    for (const raw of structure.filterColumns ?? []) addReference(raw, 'filter');
    for (const raw of structure.groupColumns ?? []) addReference(raw, 'group');
    for (const raw of structure.orderColumns ?? []) addReference(raw, 'order');
    for (const aggregate of structure.aggregates ?? []) { const resolved = resolveField(aggregate.argument, aliases, structure.tables); edges.push({ id: `lineage:aggregate:${query.id}:${aggregate.function}:${aggregate.argument}`, endpointIds: query.endpointIds, operation: 'aggregate', source: resolved, target: { kind: 'response', field: aggregate.output ?? `${aggregate.function.toLowerCase()}_${resolved.field}` }, location: query.location, confidence: resolved.table ? 'exact' : 'inferred' }); }
  }
  return { edges, fields: new Set(edges.flatMap((edge) => [`${edge.source.table ?? ''}.${edge.source.field}`, `${edge.target.table ?? ''}.${edge.target.field}`])).size, tables: new Set(edges.flatMap((edge) => [edge.source.table, edge.target.table]).filter(Boolean)).size };
}

export function parseExplain(input: string): ExplainReport {
  let engine: ExplainReport['engine'] = 'unknown'; const findings: ExplainReport['findings'] = [];
  if (/Seq Scan|Planning Time|Execution Time|"Plan"/i.test(input)) engine = 'postgresql'; else if (/select_type|possible_keys|Using filesort|"query_block"/i.test(input)) engine = 'mysql'; else if (/SCAN TABLE|SEARCH TABLE|QUERY PLAN/i.test(input)) engine = 'sqlite';
  if (/Seq Scan|SCAN TABLE/i.test(input)) findings.push({ rule: 'sequential-scan', severity: 'warning', message: '执行计划包含顺序/全表扫描' });
  if (/"access_type"\s*:\s*"ALL"/i.test(input)) findings.push({ rule: 'sequential-scan', severity: 'warning', message: 'MySQL 执行计划使用 ALL 全表访问' });
  if (/Using filesort|TEMP B-TREE/i.test(input)) findings.push({ rule: 'temporary-sort', severity: 'warning', message: '执行计划使用额外排序或临时 B-Tree' });
  const costs = [...input.matchAll(/cost=\d+(?:\.\d+)?\.\.(\d+(?:\.\d+)?)/gi)].map((item) => Number(item[1])); if (costs.some((cost) => cost > 10000)) findings.push({ rule: 'high-cost', severity: 'warning', message: `计划成本较高：${Math.max(...costs)}` });
  const rows = [...input.matchAll(/(?:rows|rows_examined_per_scan)["']?\s*[:=]\s*(\d+)/gi)].map((item) => Number(item[1])); if (rows.some((count) => count > 100000)) findings.push({ rule: 'large-row-estimate', severity: 'warning', message: `预计扫描大量记录：${Math.max(...rows)}` });
  if (/possible_keys["']?\s*[:=]\s*(?:null|NULL)|key["']?\s*[:=]\s*(?:null|NULL)/i.test(input)) findings.push({ rule: 'missing-index', severity: 'warning', message: '执行计划没有可用索引' });
  return { engine, summary: findings.length ? `发现 ${findings.length} 个执行计划风险` : '执行计划中未识别到常见风险', findings, raw: input.slice(0, 200_000) };
}

export function analyzeSecurity(result: RepositoryAnalysis, files: RepositorySourceFile[]): SecurityGovernanceReport {
  const findings: SecurityGovernanceReport['findings'] = []; const sensitive = /password|passwd|token|secret|api[_-]?key|id_card|ssn|credit_card/i;
  for (const endpoint of result.endpoints) {
    const source = endpoint.nodes.map((node) => node.location ? files.find((file) => file.path === node.location?.file)?.content.slice(0, 200_000) ?? '' : '').join('\n');
    if (!/Depends\s*\([^)]*(?:auth|user|permission)|@(?:login_required|permission_classes)|requireAuth|authorize/i.test(source)) findings.push({ id: `security:auth:${endpoint.id}`, rule: 'missing-auth', severity: 'warning', endpointId: endpoint.id, message: `${endpoint.method} ${endpoint.path} 未识别到鉴权依赖`, location: endpoint.location });
    if (sensitive.test(`${endpoint.contract.responseModel ?? ''} ${endpoint.databaseTables.flatMap((table) => table.fields.map((field) => field.name)).join(' ')}`)) findings.push({ id: `security:sensitive:${endpoint.id}`, rule: 'sensitive-response', severity: 'warning', endpointId: endpoint.id, message: `${endpoint.path} 涉及敏感字段，请确认响应脱敏`, location: endpoint.location });
    if (/upload|file/i.test(endpoint.path) && !/content[_-]?type|max[_-]?(?:size|length)|allowed_extensions/i.test(source)) findings.push({ id: `security:upload:${endpoint.id}`, rule: 'unsafe-upload', severity: 'error', endpointId: endpoint.id, message: '文件上传接口未识别到类型或大小限制', location: endpoint.location });
  }
  for (const query of result.databaseAnalysis?.queries ?? []) if (query.risks.includes('dynamic-sql')) findings.push({ id: `security:sql:${query.id}`, rule: 'sql-injection', severity: 'error', endpointId: query.endpointIds[0], message: '动态 SQL 可能存在注入风险', location: query.location, evidence: query.sql.slice(0, 200) });
  for (const file of files) if (/allow_origins\s*=\s*\[["']\*["']\]|Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*/i.test(file.content)) findings.push({ id: `security:cors:${file.path}`, rule: 'cors-wildcard', severity: 'warning', message: '发现通配 CORS 配置', location: { file: file.path, line: 1 } });
  return { score: Math.max(0, 100 - findings.reduce((sum, item) => sum + (item.severity === 'error' ? 15 : 6), 0)), findings };
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function positive(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function unquote(value: string): string { return value.replace(/["`]/g, ''); }
function splitColumns(value: string): string[] { const result: string[] = []; let depth = 0; let start = 0; for (let index = 0; index < value.length; index += 1) { if (value[index] === '(') depth += 1; else if (value[index] === ')') depth -= 1; else if (value[index] === ',' && depth === 0) { result.push(value.slice(start, index).trim()); start = index + 1; } } if (value.trim()) result.push(value.slice(start).trim()); return result; }
function resolveField(raw: string, aliases: Record<string, string>, tables: string[]): { table?: string; field: string } { const value = raw.trim().replace(/\s+(?:ASC|DESC)$/i, ''); const match = /^(?:(\w+)\.)?([\w*]+)$/.exec(value); return match ? { table: match[1] ? aliases[match[1]] ?? match[1] : tables.length === 1 ? tables[0] : undefined, field: match[2] } : { field: value }; }
