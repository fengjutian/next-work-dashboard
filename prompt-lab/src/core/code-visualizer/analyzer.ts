import type { AnalysisEdge, AnalysisNode, ApiContract, ApiEndpoint, DatabaseField, DatabaseTable, DataFlowStep, FrontendCall, HttpMethod, PerformanceRisk, RepositoryAnalysis, RepositorySourceFile, SourceLocation, TestReference } from './types';

interface PythonFunction {
  id: string;
  name: string;
  file: string;
  line: number;
  endLine: number;
  body: string;
  calls: string[];
  imports: Map<string, string>;
  tables: Array<{ name: string; mode: 'reads' | 'writes' }>;
}

interface RawEndpoint {
  framework: ApiEndpoint['framework']; method: HttpMethod; path: string; handler: string; fnId: string; routerName?: string; contract: ApiContract; location: SourceLocation;
}

const METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

export function normalizeApiPath(value: string): string {
  let path = value.trim().replace(/^https?:\/\/[^/]+/i, '');
  path = path.replace(/\$\{[^}]+\}/g, ':param').replace(/<[^>]+>/g, ':param').replace(/\{[^}]+\}/g, ':param');
  path = path.split('?')[0].replace(/\/+/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

function lineOf(content: string, index: number): number { return content.slice(0, index).split('\n').length; }
function snippetAt(content: string, line: number): string { return content.split(/\r?\n/)[line - 1]?.trim() ?? ''; }
function joinPath(prefix: string, route: string): string { return `/${[prefix, route].join('/').split('/').filter(Boolean).join('/')}`; }

function parseContract(definition: string, routePath: string, decorator = ''): ApiContract {
  const parameters = [] as ApiContract['parameters'];
  const args = /\((.*)\)/.exec(definition)?.[1] ?? '';
  for (const raw of args.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(raw);
    if (!match || ['self', 'cls'].includes(match[1])) continue;
    const defaultValue = match[3]?.trim();
    const marker = /\b(Path|Query|Header|Cookie|Body)\s*\(/i.exec(defaultValue ?? '')?.[1]?.toLowerCase();
    const source = routePath.includes(`{${match[1]}}`) ? 'path' : marker === 'header' || marker === 'cookie' || marker === 'body' || marker === 'path' ? marker : 'query';
    parameters.push({ name: match[1], source, type: match[2]?.trim() ?? 'Any', required: defaultValue === undefined || /\.\.\./.test(defaultValue), defaultValue });
  }
  const responseModel = /\bresponse_model\s*=\s*([^,)]+)/.exec(decorator)?.[1]?.trim() ?? /\)\s*->\s*([^:]+)/.exec(definition)?.[1]?.trim();
  const status = Number(/\bstatus_code\s*=\s*(\d+)/.exec(decorator)?.[1] ?? 200);
  const requestModel = parameters.find((parameter) => parameter.source === 'body' && !['str', 'int', 'float', 'bool', 'dict', 'list', 'Any'].includes(parameter.type))?.type;
  return { parameters, requestModel, responseModel, statusCodes: [status] };
}

export function extractFrontendCalls(file: RepositorySourceFile): FrontendCall[] {
  if (!/\.(vue|tsx?|jsx?)$/i.test(file.path)) return [];
  const calls: FrontendCall[] = [];
  const clients = new Map<string, string>([['axios', '']]);
  for (const client of file.content.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*axios\.create\s*\(\s*\{[\s\S]{0,500}?baseURL\s*:\s*["'`]([^"'`]+)["'`]/gim)) clients.set(client[1], client[2]);
  const patterns = [
    /\b(\w+)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'`])([^"'`]+)\3/gim,
    /\bfetch\s*\(\s*(["'`])([^"'`]+)\1\s*(?:,\s*\{([\s\S]{0,300}?)\})?/gim,
    /\b(?:request|http|api)\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/gim,
  ];
  let match: RegExpExecArray | null;
  while ((match = patterns[0].exec(file.content))) {
    if (clients.has(match[1]) || /^(request|http|api)$/i.test(match[1])) push(String(match[2]), joinPath(clients.get(match[1]) ?? '', match[4]), match.index);
  }
  while ((match = patterns[1].exec(file.content))) {
    const method = /method\s*:\s*["'](\w+)/i.exec(match[3] ?? '')?.[1] ?? 'GET';
    push(method, match[2], match.index);
  }
  while ((match = patterns[2].exec(file.content))) {
    const block = match[1];
    const url = /(?:url|path)\s*:\s*(["'`])([^"'`]+)\1/i.exec(block)?.[2];
    const method = /method\s*:\s*["'](\w+)/i.exec(block)?.[1] ?? 'GET';
    if (url) push(method, url, match.index);
  }
  return calls;

  function push(rawMethod: string, path: string, index: number): void {
    const method = rawMethod.toUpperCase() as HttpMethod;
    if (!METHODS.has(method)) return;
    const line = lineOf(file.content, index);
    calls.push({ id: `frontend:${file.path}:${line}:${method}`, method, path, normalizedPath: normalizeApiPath(path), location: { file: file.path, line, snippet: snippetAt(file.content, line) } });
  }
}

function extractPython(file: RepositorySourceFile): { functions: PythonFunction[]; endpoints: RawEndpoint[]; modelTables: Map<string, string>; modelSchemas: Map<string, DatabaseTable> } {
  const lines = file.content.split(/\r?\n/);
  const functions: PythonFunction[] = [];
  const endpoints: RawEndpoint[] = [];
  const modelTables = new Map<string, string>();
  const modelSchemas = new Map<string, DatabaseTable>();
  const routerPrefixes = new Map<string, string>();
  const imports = new Map<string, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const imported = /^\s*from\s+([\w.]+)\s+import\s+(.+)/.exec(lines[i]);
    if (imported) for (const item of imported[2].split(',')) {
      const symbol = /^(\w+)(?:\s+as\s+(\w+))?/.exec(item.trim());
      if (symbol) imports.set(symbol[2] ?? symbol[1], `${imported[1]}.${symbol[1]}`);
    }
    const moduleImport = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/.exec(lines[i]);
    if (moduleImport) imports.set(moduleImport[2] ?? moduleImport[1].split('.')[0], moduleImport[1]);
    const prefix = /^\s*(\w+)\s*=\s*(?:APIRouter|Blueprint)\s*\([\s\S]*?(?:prefix|url_prefix)\s*=\s*["']([^"']*)/.exec(lines[i]);
    if (prefix) routerPrefixes.set(prefix[1], prefix[2]);
    const classMatch = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/.exec(lines[i]);
    const bases = classMatch?.[2].split(',').map((base) => base.trim()) ?? [];
    const isOrmModel = bases.some((base) => base === 'Base' || base === 'db.Model' || base === 'models.Model' || base.endsWith('.Model')) && !bases.some((base) => /BaseModel|Service|Schema|Serializer/.test(base));
    if (classMatch && isOrmModel) {
      let table = classMatch[1].replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase();
      const fields: DatabaseField[] = [];
      let classEnd = i + 1;
      while (classEnd < lines.length && !/^(?:class|def|async\s+def)\s+/.test(lines[classEnd])) classEnd += 1;
      for (let j = i + 1; j < classEnd; j += 1) {
        if (/^class\s+/.test(lines[j])) break;
        const declared = /__tablename__\s*=\s*["']([^"']+)/.exec(lines[j])
          ?? (/class\s+Meta\s*:/.test(lines[j]) ? /db_table\s*=\s*["']([^"']+)/.exec(lines[j + 1] ?? '') : null);
        if (declared?.[1]) { table = declared[1]; break; }
      }
      for (let j = i + 1; j < classEnd; j += 1) {
        const sqlalchemy = /^\s+(\w+)\s*(?::\s*Mapped\[([^\]]+)\])?\s*=\s*(?:mapped_column|Column)\s*\((.*)\)\s*$/.exec(lines[j]);
        const django = /^\s+(\w+)\s*=\s*models\.(\w+Field)\s*\((.*)\)\s*$/.exec(lines[j]);
        const match = sqlalchemy ?? django;
        if (!match) continue;
        const options = match[3] ?? '';
        const rawType = sqlalchemy ? sqlalchemy[2] ?? options.split(',')[0]?.trim() ?? 'Any' : django?.[2] ?? 'Any';
        const foreignKey = sqlalchemy
          ? /ForeignKey\s*\(\s*["']([^"']+)/.exec(options)?.[1]
          : /^(?:ForeignKey|OneToOneField|ManyToManyField)$/.test(django?.[2] ?? '') ? /(?:to\s*=\s*)?["']([^"']+)["']/.exec(options)?.[1] : undefined;
        fields.push({ name: match[1], type: rawType.replace(/^models\./, ''), primaryKey: /primary_key\s*=\s*True/.test(options), nullable: /nullable\s*=\s*True|null\s*=\s*True/.test(options), defaultValue: /default\s*=\s*([^,)]+)/.exec(options)?.[1]?.trim(), foreignKey, location: { file: file.path, line: j + 1, snippet: lines[j].trim() } });
      }
      modelTables.set(classMatch[1], table);
      modelSchemas.set(classMatch[1], { name: table, model: classMatch[1], fields, location: { file: file.path, line: i + 1, endLine: classEnd, snippet: lines[i].trim() } });
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const def = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (!def) continue;
    const indent = def[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === '' || (lines[end].match(/^\s*/)?.[0].length ?? 0) > indent)) end += 1;
    const body = lines.slice(i, end).join('\n');
    const calls = [...body.matchAll(/\b(?:await\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)].map((m) => m[1]).filter((name) => !['if', 'for', 'return', 'print', def[2]].includes(name));
    for (const dependency of body.matchAll(/\bDepends\s*\(\s*([\w.]+)/g)) calls.push(dependency[1]);
    const tables: PythonFunction['tables'] = [];
    for (const [model, table] of modelTables) {
      if (new RegExp(`\\b${model}\\b`).test(body)) tables.push({ name: table, mode: /\.(add|delete|update|save|create)\s*\(|\.objects\.(create|update)/.test(body) ? 'writes' : 'reads' });
    }
    for (const sql of body.matchAll(/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([\w."`]+)/gi)) {
      tables.push({ name: sql[2].replace(/["`]/g, ''), mode: /^SELECT$/i.test(sql[1]) ? 'reads' : 'writes' });
    }
    const fn: PythonFunction = { id: `python:${file.path}:${i + 1}`, name: def[2], file: file.path, line: i + 1, endLine: end, body, calls: [...new Set(calls)], imports, tables };
    functions.push(fn);

    const decorators: string[] = [];
    for (let j = i - 1; j >= 0 && (lines[j].trim().startsWith('@') || lines[j].trim() === ''); j -= 1) if (lines[j].trim()) decorators.unshift(lines[j].trim());
    for (const decorator of decorators) {
      const route = /^@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)/i.exec(decorator);
      if (route) endpoints.push({ framework: 'fastapi', method: route[2].toUpperCase() as HttpMethod, path: joinPath(routerPrefixes.get(route[1]) ?? '', route[3]), handler: def[2], fnId: fn.id, routerName: route[1], contract: parseContract(lines[i], route[3], decorator), location: { file: file.path, line: i + 1, endLine: end, snippet: lines[i].trim() } });
      const flask = /^@(\w+)\.route\s*\(\s*["']([^"']+)["']/i.exec(decorator);
      if (flask) {
        const methodBlock = /methods\s*=\s*\[([^\]]+)\]/i.exec(decorator)?.[1];
        const methods = methodBlock?.match(/["'](\w+)["']/g)?.map((x) => x.replace(/["']/g, '')) ?? ['GET'];
        for (const methodText of methods) endpoints.push({ framework: 'flask', method: methodText.toUpperCase() as HttpMethod, path: joinPath(routerPrefixes.get(flask[1]) ?? '', flask[2]), handler: def[2], fnId: fn.id, contract: parseContract(lines[i], flask[2], decorator), location: { file: file.path, line: i + 1, endLine: end, snippet: lines[i].trim() } });
      }
    }
  }

  for (const match of file.content.matchAll(/\bpath\s*\(\s*["']([^"']*)["']\s*,\s*([\w.]+)(?:\.as_view\(\))?/g)) {
    const handler = match[2].split('.').pop() ?? match[2];
    const fn = functions.find((item) => item.name === handler);
    const index = match.index ?? 0;
    endpoints.push({ framework: /ViewSet|APIView/.test(match[2]) ? 'drf' : 'django', method: 'GET', path: `/${match[1]}`, handler, fnId: fn?.id ?? `django:${file.path}:${lineOf(file.content, index)}`, contract: parseContract(fn ? lines[fn.line - 1] : '', match[1]), location: { file: file.path, line: lineOf(file.content, index), snippet: snippetAt(file.content, lineOf(file.content, index)) } });
  }
  return { functions, endpoints, modelTables, modelSchemas };
}

function findMountedRouterPrefixes(files: RepositorySourceFile[]): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const host of files) {
    const imports = new Map<string, string>();
    for (const match of host.content.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(\w+)(?:\s+as\s+(\w+))?/gm)) imports.set(match[3] ?? match[2], match[1]);
    for (const mount of host.content.matchAll(/\binclude_router\s*\(\s*(\w+)[\s\S]{0,300}?\)/g)) {
      const moduleName = imports.get(mount[1]);
      if (!moduleName) continue;
      const modulePath = `${moduleName.replace(/\./g, '/')}.py`;
      const target = files.find((file) => file.path.endsWith(modulePath));
      if (!target) continue;
      const prefix = /\bprefix\s*=\s*["']([^"']*)/.exec(mount[0])?.[1] ?? '';
      prefixes.set(target.path, joinPath(prefixes.get(target.path) ?? '', prefix));
    }
  }
  return prefixes;
}

function buildDataFlow(contract: ApiContract, handler: string, location: SourceLocation, frontend: FrontendCall[], tables: DatabaseTable[]): DataFlowStep[] {
  const steps: DataFlowStep[] = frontend.map((call) => ({ id: `flow:${call.id}`, stage: 'frontend', label: call.path, detail: call.location.file, location: call.location }));
  for (const parameter of contract.parameters) steps.push({ id: `flow:param:${parameter.source}:${parameter.name}`, stage: 'parameter', label: parameter.name, detail: `${parameter.source} · ${parameter.type}` });
  if (contract.requestModel) steps.push({ id: `flow:model:${contract.requestModel}`, stage: 'model', label: contract.requestModel, detail: 'Request Model' });
  steps.push({ id: `flow:handler:${handler}`, stage: 'handler', label: handler, location });
  const parameterNames = new Set(contract.parameters.map((parameter) => parameter.name.replace(/_id$/, '')));
  for (const table of tables) for (const field of table.fields) {
    if (parameterNames.has(field.name) || parameterNames.has(field.name.replace(/_id$/, '')) || contract.requestModel) steps.push({ id: `flow:field:${table.name}:${field.name}`, stage: 'field', label: `${table.name}.${field.name}`, detail: field.type, location: field.location });
  }
  return steps;
}

function findTests(files: RepositorySourceFile[], endpoint: RawEndpoint): TestReference[] {
  const references: TestReference[] = [];
  for (const file of files) {
    if (!/(^|\/)(tests?|__tests__|e2e)(\/|$)|\.(test|spec)\.[jt]sx?$/i.test(file.path)) continue;
    const index = file.content.search(new RegExp(`${escapeRegExp(endpoint.handler)}|${escapeRegExp(endpoint.path)}`));
    if (index < 0) continue;
    references.push({ file: file.path, line: lineOf(file.content, index), kind: /e2e|playwright|cypress/i.test(file.path + file.content.slice(0, 300)) ? 'e2e' : file.path.endsWith('.py') ? 'backend' : 'frontend', evidence: snippetAt(file.content, lineOf(file.content, index)) });
  }
  return references;
}

function findPerformanceRisks(functions: PythonFunction[]): PerformanceRisk[] {
  const risks: PerformanceRisk[] = [];
  for (const fn of functions) {
    const location = { file: fn.file, line: fn.line, endLine: fn.endLine, snippet: snippetAt(fn.body, 1) };
    if (/\b(?:for|while)\b[\s\S]{0,800}?\.(?:query|execute|filter|get|all|first)\s*\(/.test(fn.body)) risks.push({ id: `perf:loop:${fn.id}`, rule: 'query-in-loop', severity: 'error', message: `${fn.name} 可能在循环中执行数据库查询`, location });
    if (/\.(?:all|fetchall)\s*\(\)/.test(fn.body) && !/\.(?:limit|paginate)\s*\(/.test(fn.body)) risks.push({ id: `perf:all:${fn.id}`, rule: 'unbounded-query', severity: 'warning', message: `${fn.name} 存在未限制结果数量的查询`, location });
    if (/^async\s+def/.test(fn.body.trim()) && /\b(?:time\.sleep|requests\.|subprocess\.(?:run|call)|open)\s*\(/.test(fn.body)) risks.push({ id: `perf:blocking:${fn.id}`, rule: 'blocking-in-async', severity: 'error', message: `${fn.name} 的异步函数中可能存在阻塞调用`, location });
  }
  if (functions.length > 7) risks.push({ id: `perf:depth:${functions[0]?.id}`, rule: 'deep-call-chain', severity: 'warning', message: `调用链深度达到 ${functions.length} 层`, location: { file: functions[0].file, line: functions[0].line } });
  const tableReads = new Map<string, number>();
  for (const fn of functions) for (const table of fn.tables.filter((item) => item.mode === 'reads')) tableReads.set(table.name, (tableReads.get(table.name) ?? 0) + 1);
  for (const [table, count] of tableReads) if (count > 1) risks.push({ id: `perf:duplicate:${functions[0]?.id}:${table}`, rule: 'duplicate-table-read', severity: 'warning', message: `同一调用链读取 ${table} ${count} 次`, location: { file: functions[0].file, line: functions[0].line } });
  return risks;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function analyzeRepositoryFiles(rootPath: string, files: RepositorySourceFile[]): RepositoryAnalysis {
  const pythonFiles = files.filter((file) => file.path.endsWith('.py'));
  const vueFiles = files.filter((file) => /\.(vue|tsx?|jsx?)$/i.test(file.path));
  const py = pythonFiles.map(extractPython);
  const functions = py.flatMap((item) => item.functions);
  const globalModels = new Map<string, string>();
  const globalSchemas = new Map<string, DatabaseTable>();
  for (const item of py) for (const [model, table] of item.modelTables) globalModels.set(model, table);
  for (const item of py) for (const schema of item.modelSchemas.values()) globalSchemas.set(schema.name, schema);
  for (const fn of functions) for (const [model, table] of globalModels) {
    if (!fn.tables.some((entry) => entry.name === table) && new RegExp(`\\b${model}\\b`).test(fn.body)) {
      const writes = /\.(add|delete|update|save|create)\s*\(|\.objects\.(create|update|delete)|\b(INSERT|UPDATE|DELETE)\b/i.test(fn.body);
      fn.tables.push({ name: table, mode: writes ? 'writes' : 'reads' });
    }
  }
  const mountedPrefixes = findMountedRouterPrefixes(pythonFiles);
  const rawEndpoints = py.flatMap((item) => item.endpoints).map((endpoint) => ({
    ...endpoint,
    path: joinPath(mountedPrefixes.get(endpoint.location.file) ?? '', endpoint.path),
  }));
  const frontendCalls = vueFiles.flatMap(extractFrontendCalls);
  const byName = new Map<string, PythonFunction[]>();
  for (const fn of functions) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn]);

  const resolveCall = (call: string, caller: PythonFunction): { fn?: PythonFunction; confidence: AnalysisEdge['confidence']; evidence: string } => {
    const parts = call.split('.');
    const name = parts.at(-1) ?? call;
    const candidates = byName.get(name) ?? [];
    const local = candidates.find((candidate) => candidate.file === caller.file);
    if (local) return { fn: local, confidence: 'exact', evidence: `同文件符号 ${call}` };
    const imported = caller.imports.get(parts[0]);
    if (imported) {
      const moduleName = imported.split('.').slice(0, -1).join('.');
      const modulePath = `${moduleName.replace(/\./g, '/')}.py`;
      const matched = candidates.find((candidate) => candidate.file.endsWith(modulePath));
      if (matched) return { fn: matched, confidence: 'exact', evidence: `由 import ${imported} 解析` };
    }
    return { fn: candidates.length === 1 ? candidates[0] : undefined, confidence: 'inferred', evidence: candidates.length === 1 ? `仓库内唯一同名符号 ${name}` : `无法消歧 ${call}` };
  };

  const endpoints = rawEndpoints.map((raw): ApiEndpoint => {
    const nodes: AnalysisNode[] = [{ id: `endpoint:${raw.method}:${normalizeApiPath(raw.path)}`, kind: 'endpoint', label: `${raw.method} ${raw.path}`, detail: raw.framework, location: raw.location }];
    const edges: AnalysisEdge[] = [];
    const endpointId = nodes[0].id;
    const matchingFrontend = frontendCalls.filter((call) => call.method === raw.method && call.normalizedPath === normalizeApiPath(raw.path));
    for (const call of matchingFrontend) {
      nodes.push({ id: call.id, kind: 'frontend', label: call.location.file.split('/').pop() ?? call.location.file, detail: call.location.snippet, location: call.location });
      edges.push({ source: call.id, target: endpointId, kind: 'requests', confidence: 'exact' });
    }
    const visited = new Set<string>();
    const walkedFunctions: PythonFunction[] = [];
    const tables = new Set<string>();
    const walk = (fn: PythonFunction | undefined, parentId: string, depth: number, relation?: { confidence: AnalysisEdge['confidence']; evidence: string }): void => {
      if (!fn || visited.has(fn.id) || depth > 8) return;
      visited.add(fn.id);
      walkedFunctions.push(fn);
      const kind: AnalysisNode['kind'] = depth === 0 ? 'controller' : /repo|dao|crud/i.test(fn.name + fn.file) ? 'repository' : 'service';
      nodes.push({ id: fn.id, kind, label: fn.name, detail: fn.file, location: { file: fn.file, line: fn.line, endLine: fn.endLine, snippet: snippetAt(fn.body, 1) } });
      edges.push({ source: parentId, target: fn.id, kind: depth === 0 ? 'handles' : 'calls', confidence: depth === 0 ? 'exact' : relation?.confidence ?? 'inferred', evidence: depth === 0 ? '路由装饰器绑定' : relation?.evidence });
      for (const table of fn.tables) {
        tables.add(table.name);
        const tableId = `table:${table.name}`;
        if (!nodes.some((node) => node.id === tableId)) nodes.push({ id: tableId, kind: 'database', label: table.name });
        edges.push({ source: fn.id, target: tableId, kind: table.mode, confidence: 'inferred' });
      }
      for (const call of fn.calls) {
        const resolved = resolveCall(call, fn);
        walk(resolved.fn, fn.id, depth + 1, resolved);
      }
    };
    walk(functions.find((fn) => fn.id === raw.fnId) ?? byName.get(raw.handler)?.[0], endpointId, 0);
    const databaseTables = [...tables].map((table) => globalSchemas.get(table) ?? { name: table, fields: [] });
    return { id: endpointId, framework: raw.framework, method: raw.method, path: raw.path, normalizedPath: normalizeApiPath(raw.path), handler: raw.handler, location: raw.location, frontendCalls: matchingFrontend, tables: [...tables], databaseTables, dataFlow: buildDataFlow(raw.contract, raw.handler, raw.location, matchingFrontend, databaseTables), tests: findTests(files, raw), performanceRisks: findPerformanceRisks(walkedFunctions), nodes, edges, contract: raw.contract, diagnostics: [] };
  });
  const unique = [...new Map(endpoints.map((endpoint) => [`${endpoint.method}:${endpoint.normalizedPath}:${endpoint.location.file}`, endpoint])).values()];
  return { rootPath, scannedAt: Date.now(), filesScanned: files.length, pythonFiles: pythonFiles.length, vueFiles: vueFiles.length, endpoints: unique.sort((a, b) => a.path.localeCompare(b.path)), warnings: rawEndpoints.length === 0 ? ['未发现静态可解析的 Python 接口；动态注册的路由暂不支持。'] : [] };
}
