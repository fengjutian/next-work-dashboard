import type { ApiParameter, CoverageReport, GitImpactReport, HttpMethod, OpenApiGovernanceReport, OpenApiOperation, OpenApiSchemaField, QualityGateReport, RepositoryAnalysis } from './types';
import { normalizeApiPath } from './analyzer';

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

export function parseOpenApiDocument(document: unknown): { title?: string; version?: string; operations: OpenApiOperation[] } {
  const root = asRecord(document);
  const info = asRecord(root.info);
  const operations: OpenApiOperation[] = [];
  for (const [route, rawPath] of Object.entries(asRecord(root.paths))) {
    const pathItem = asRecord(rawPath);
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      if (!METHODS.has(rawMethod.toLowerCase())) continue;
      const operation = asRecord(rawOperation);
      const parameters = [...array(pathItem.parameters), ...array(operation.parameters)].map(parseParameter).filter((item): item is ApiParameter => Boolean(item));
      const responses = asRecord(operation.responses);
      operations.push({
        method: rawMethod.toUpperCase() as HttpMethod,
        path: route,
        normalizedPath: normalizeApiPath(route),
        operationId: string(operation.operationId),
        parameters,
        requestModel: schemaName(asRecord(operation.requestBody)),
        responseModel: Object.values(responses).map((response) => schemaName(asRecord(response))).find(Boolean),
        statusCodes: Object.keys(responses).map(Number).filter(Number.isFinite),
        requestFields: flattenSchema(contentSchema(asRecord(operation.requestBody)), root),
        responseFields: flattenSchema(Object.values(responses).map((response) => contentSchema(asRecord(response))).find((schema) => Object.keys(schema).length) ?? {}, root),
      });
    }
  }
  return { title: string(info.title), version: string(info.version), operations };
}

export function compareOpenApi(result: RepositoryAnalysis, document: unknown): OpenApiGovernanceReport {
  const parsed = parseOpenApiDocument(document);
  const code = new Map(result.endpoints.map((item) => [`${item.method} ${item.normalizedPath}`, item]));
  const spec = new Map(parsed.operations.map((item) => [`${item.method} ${item.normalizedPath}`, item]));
  const contractMismatches: OpenApiGovernanceReport['contractMismatches'] = [];
  for (const [key, operation] of spec) {
    const endpoint = code.get(key); if (!endpoint) continue;
    const changes: string[] = [];
    const codeRequired = new Set(endpoint.contract.parameters.filter((item) => item.required).map((item) => `${item.source}:${item.name}`));
    const specRequired = new Set(operation.parameters.filter((item) => item.required).map((item) => `${item.source}:${item.name}`));
    for (const parameter of specRequired) if (!codeRequired.has(parameter)) changes.push(`规范必填参数未在代码契约中体现：${parameter}`);
    for (const parameter of codeRequired) if (!specRequired.has(parameter)) changes.push(`代码新增必填参数：${parameter}`);
    if (operation.responseModel && endpoint.contract.responseModel && operation.responseModel !== endpoint.contract.responseModel) changes.push(`响应模型：${operation.responseModel} → ${endpoint.contract.responseModel}`);
    if (changes.length) contractMismatches.push({ endpoint: key, changes, breaking: changes.some((item) => item.startsWith('代码新增必填参数') || item.startsWith('响应模型')) });
  }
  return { ...parsed, undocumentedCode: [...code.keys()].filter((key) => !spec.has(key)), missingImplementation: [...spec.keys()].filter((key) => !code.has(key)), contractMismatches };
}

export function compareOpenApiDocuments(beforeDocument: unknown, afterDocument: unknown): OpenApiGovernanceReport['contractMismatches'] {
  const before = new Map(parseOpenApiDocument(beforeDocument).operations.map((item) => [`${item.method} ${item.normalizedPath}`, item]));
  const after = new Map(parseOpenApiDocument(afterDocument).operations.map((item) => [`${item.method} ${item.normalizedPath}`, item]));
  const changes: OpenApiGovernanceReport['contractMismatches'] = [];
  for (const [key, oldOperation] of before) {
    const next = after.get(key);
    if (!next) { changes.push({ endpoint: key, changes: ['接口已删除'], breaking: true }); continue; }
    const detail: string[] = [];
    const oldRequest = new Map(oldOperation.requestFields.map((field) => [field.path, field]));
    const nextRequest = new Map(next.requestFields.map((field) => [field.path, field]));
    const oldResponse = new Map(oldOperation.responseFields.map((field) => [field.path, field]));
    const nextResponse = new Map(next.responseFields.map((field) => [field.path, field]));
    for (const [path, field] of nextRequest) if (!oldRequest.has(path) && field.required) detail.push(`新增必填请求字段：${path}`);
    for (const [path] of oldResponse) if (!nextResponse.has(path)) detail.push(`删除响应字段：${path}`);
    for (const [path, field] of oldRequest) if (nextRequest.has(path) && nextRequest.get(path)?.type !== field.type) detail.push(`请求字段类型变化：${path} ${field.type} → ${nextRequest.get(path)?.type}`);
    for (const [path, field] of oldResponse) if (nextResponse.has(path) && nextResponse.get(path)?.type !== field.type) detail.push(`响应字段类型变化：${path} ${field.type} → ${nextResponse.get(path)?.type}`);
    if (detail.length) changes.push({ endpoint: key, changes: detail, breaking: true });
  }
  return changes;
}

export function buildQualityGate(result: RepositoryAnalysis, coverage?: CoverageReport, minimumCoverage = .8): QualityGateReport {
  const coverageByFile = new Map((coverage?.files ?? []).map((file) => [normalizeFile(file.file), file]));
  const endpointCoverage = result.endpoints.map((endpoint) => {
    const files = [...new Set(endpoint.nodes.flatMap((node) => node.location?.file ? [node.location.file] : []))];
    const matched = files.map((file) => coverageByFile.get(normalizeFile(file))).filter((file): file is CoverageReport['files'][number] => Boolean(file));
    const found = matched.reduce((sum, file) => sum + file.linesFound, 0); const hit = matched.reduce((sum, file) => sum + file.linesHit, 0);
    return { endpoint: `${endpoint.method} ${endpoint.path}`, files, lineRate: found ? hit / found : 0, covered: found > 0 };
  });
  const failures: QualityGateReport['failures'] = [];
  for (const mismatch of result.openApi?.contractMismatches.filter((item) => item.breaking) ?? []) failures.push({ rule: 'breaking-contract', endpoint: mismatch.endpoint, message: mismatch.changes.join('；') });
  for (const missing of result.openApi?.missingImplementation ?? []) failures.push({ rule: 'missing-implementation', endpoint: missing, message: 'OpenAPI 接口没有代码实现' });
  for (const endpoint of result.endpoints.filter((item) => item.tests.length === 0)) failures.push({ rule: 'missing-test', endpoint: `${endpoint.method} ${endpoint.path}`, message: '接口没有关联测试' });
  for (const item of endpointCoverage.filter((entry) => entry.covered && entry.lineRate < minimumCoverage)) failures.push({ rule: 'low-coverage', endpoint: item.endpoint, message: `接口关联代码覆盖率 ${(item.lineRate * 100).toFixed(1)}%，低于 ${(minimumCoverage * 100).toFixed(0)}%` });
  return { passed: failures.length === 0, score: Math.max(0, 100 - failures.length * 5), failures, endpointCoverage };
}

export function calculateGitImpact(result: RepositoryAnalysis, changedFiles: string[], base: string, head = 'WORKTREE'): GitImpactReport {
  const changed = new Set(changedFiles.map((file) => file.replace(/\\/g, '/')));
  const endpoints = result.endpoints.filter((endpoint) => endpoint.nodes.some((node) => node.location && changed.has(node.location.file)) || endpoint.tests.some((test) => changed.has(test.file)));
  return { base, head, changedFiles: [...changed], endpoints: endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`), tests: [...new Set(endpoints.flatMap((endpoint) => endpoint.tests.map((test) => test.file)))], tables: [...new Set(endpoints.flatMap((endpoint) => endpoint.tables))] };
}

export function gitImpactMarkdown(report: GitImpactReport): string {
  const section = (title: string, values: string[]) => `### ${title}\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- 无'}`;
  return [`## 接口变更影响`, `基线：\`${report.base}\` → \`${report.head}\``, section('变更文件', report.changedFiles), section('受影响接口', report.endpoints), section('关联测试', report.tests), section('数据表', report.tables)].join('\n\n');
}

function parseParameter(input: unknown): ApiParameter | null {
  const value = asRecord(input); const name = string(value.name); const source = string(value.in);
  if (!name || !['path', 'query', 'header', 'cookie'].includes(source ?? '')) return null;
  const schema = asRecord(value.schema);
  return { name, source: source as ApiParameter['source'], type: string(schema.type) ?? schemaName(schema) ?? 'Any', required: value.required === true || source === 'path', defaultValue: schema.default === undefined ? undefined : String(schema.default) };
}
function schemaName(value: Record<string, unknown>): string | undefined { const schema = contentSchema(value); return string(schema.$ref)?.split('/').at(-1) ?? string(schema.type); }
function contentSchema(value: Record<string, unknown>): Record<string, unknown> { return asRecord(asRecord(asRecord(value.content)['application/json']).schema ?? value.schema); }
function flattenSchema(input: Record<string, unknown>, root: Record<string, unknown>, prefix = '', seen = new Set<string>()): OpenApiSchemaField[] {
  const reference = string(input.$ref);
  if (reference) {
    if (seen.has(reference)) return [];
    const target = reference.split('/').slice(1).reduce<unknown>((value, key) => asRecord(value)[key], root);
    return flattenSchema(asRecord(target), root, prefix, new Set(seen).add(reference));
  }
  if (input.type === 'array') return flattenSchema(asRecord(input.items), root, `${prefix}[]`, seen);
  const properties = asRecord(input.properties); const required = new Set(array(input.required).map(String));
  return Object.entries(properties).flatMap(([name, raw]) => {
    const schema = asRecord(raw); const path = prefix ? `${prefix}.${name}` : name; const nested = flattenSchema(schema, root, path, seen);
    return [{ path, type: string(schema.type) ?? (schema.$ref ? 'object' : 'Any'), required: required.has(name), nullable: schema.nullable === true, enumValues: array(schema.enum).map(String) }, ...nested];
  });
}
function normalizeFile(file: string): string { return file.replace(/\\/g, '/').replace(/^.*?\/(?:src|app)\//, 'src/'); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
