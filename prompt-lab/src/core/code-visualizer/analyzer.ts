import type { AnalysisEdge, AnalysisNode, ApiEndpoint, FrontendCall, HttpMethod, RepositoryAnalysis, RepositorySourceFile, SourceLocation } from './types';

interface PythonFunction {
  id: string;
  name: string;
  file: string;
  line: number;
  endLine: number;
  body: string;
  calls: string[];
  tables: Array<{ name: string; mode: 'reads' | 'writes' }>;
}

interface RawEndpoint {
  framework: ApiEndpoint['framework']; method: HttpMethod; path: string; handler: string; fnId: string; location: SourceLocation;
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

export function extractFrontendCalls(file: RepositorySourceFile): FrontendCall[] {
  if (!/\.(vue|tsx?|jsx?)$/i.test(file.path)) return [];
  const calls: FrontendCall[] = [];
  const patterns = [
    /\baxios\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'`])([^"'`]+)\2/gim,
    /\bfetch\s*\(\s*(["'`])([^"'`]+)\1\s*(?:,\s*\{([\s\S]{0,300}?)\})?/gim,
    /\b(?:request|http|api)\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/gim,
  ];
  let match: RegExpExecArray | null;
  while ((match = patterns[0].exec(file.content))) push(String(match[1]), match[3], match.index);
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

function extractPython(file: RepositorySourceFile): { functions: PythonFunction[]; endpoints: RawEndpoint[]; modelTables: Map<string, string> } {
  const lines = file.content.split(/\r?\n/);
  const functions: PythonFunction[] = [];
  const endpoints: RawEndpoint[] = [];
  const modelTables = new Map<string, string>();
  const routerPrefixes = new Map<string, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const prefix = /^\s*(\w+)\s*=\s*(?:APIRouter|Blueprint)\s*\([\s\S]*?(?:prefix|url_prefix)\s*=\s*["']([^"']*)/.exec(lines[i]);
    if (prefix) routerPrefixes.set(prefix[1], prefix[2]);
    const classMatch = /^class\s+(\w+)\s*\([^)]*(?:Model|Base)[^)]*\)\s*:/.exec(lines[i]);
    if (classMatch) {
      let table = classMatch[1].replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase();
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
        if (/^class\s+/.test(lines[j])) break;
        const declared = /__tablename__\s*=\s*["']([^"']+)/.exec(lines[j])
          ?? (/class\s+Meta\s*:/.test(lines[j]) ? /db_table\s*=\s*["']([^"']+)/.exec(lines[j + 1] ?? '') : null);
        if (declared?.[1]) { table = declared[1]; break; }
      }
      modelTables.set(classMatch[1], table);
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const def = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (!def) continue;
    const indent = def[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === '' || (lines[end].match(/^\s*/)?.[0].length ?? 0) > indent)) end += 1;
    const body = lines.slice(i, end).join('\n');
    const calls = [...body.matchAll(/\b(?:await\s+)?(?:\w+\.)*(\w+)\s*\(/g)].map((m) => m[1]).filter((name) => !['if', 'for', 'return', 'print', def[2]].includes(name));
    const tables: PythonFunction['tables'] = [];
    for (const [model, table] of modelTables) {
      if (new RegExp(`\\b${model}\\b`).test(body)) tables.push({ name: table, mode: /\.(add|delete|update|save|create)\s*\(|\.objects\.(create|update)/.test(body) ? 'writes' : 'reads' });
    }
    for (const sql of body.matchAll(/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([\w."`]+)/gi)) {
      tables.push({ name: sql[2].replace(/["`]/g, ''), mode: /^SELECT$/i.test(sql[1]) ? 'reads' : 'writes' });
    }
    const fn: PythonFunction = { id: `python:${file.path}:${i + 1}`, name: def[2], file: file.path, line: i + 1, endLine: end, body, calls: [...new Set(calls)], tables };
    functions.push(fn);

    const decorators: string[] = [];
    for (let j = i - 1; j >= 0 && (lines[j].trim().startsWith('@') || lines[j].trim() === ''); j -= 1) if (lines[j].trim()) decorators.unshift(lines[j].trim());
    for (const decorator of decorators) {
      const route = /^@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)/i.exec(decorator);
      if (route) endpoints.push({ framework: route[1] === 'app' ? 'fastapi' : 'fastapi', method: route[2].toUpperCase() as HttpMethod, path: joinPath(routerPrefixes.get(route[1]) ?? '', route[3]), handler: def[2], fnId: fn.id, location: { file: file.path, line: i + 1, endLine: end, snippet: lines[i].trim() } });
      const flask = /^@(\w+)\.route\s*\(\s*["']([^"']+)["']/i.exec(decorator);
      if (flask) {
        const methodBlock = /methods\s*=\s*\[([^\]]+)\]/i.exec(decorator)?.[1];
        const methods = methodBlock?.match(/["'](\w+)["']/g)?.map((x) => x.replace(/["']/g, '')) ?? ['GET'];
        for (const methodText of methods) endpoints.push({ framework: 'flask', method: methodText.toUpperCase() as HttpMethod, path: joinPath(routerPrefixes.get(flask[1]) ?? '', flask[2]), handler: def[2], fnId: fn.id, location: { file: file.path, line: i + 1, endLine: end, snippet: lines[i].trim() } });
      }
    }
  }

  for (const match of file.content.matchAll(/\bpath\s*\(\s*["']([^"']*)["']\s*,\s*([\w.]+)(?:\.as_view\(\))?/g)) {
    const handler = match[2].split('.').pop() ?? match[2];
    const fn = functions.find((item) => item.name === handler);
    const index = match.index ?? 0;
    endpoints.push({ framework: /ViewSet|APIView/.test(match[2]) ? 'drf' : 'django', method: 'GET', path: `/${match[1]}`, handler, fnId: fn?.id ?? `django:${file.path}:${lineOf(file.content, index)}`, location: { file: file.path, line: lineOf(file.content, index), snippet: snippetAt(file.content, lineOf(file.content, index)) } });
  }
  return { functions, endpoints, modelTables };
}

export function analyzeRepositoryFiles(rootPath: string, files: RepositorySourceFile[]): RepositoryAnalysis {
  const pythonFiles = files.filter((file) => file.path.endsWith('.py'));
  const vueFiles = files.filter((file) => /\.(vue|tsx?|jsx?)$/i.test(file.path));
  const py = pythonFiles.map(extractPython);
  const functions = py.flatMap((item) => item.functions);
  const rawEndpoints = py.flatMap((item) => item.endpoints);
  const frontendCalls = vueFiles.flatMap(extractFrontendCalls);
  const byName = new Map<string, PythonFunction[]>();
  for (const fn of functions) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn]);

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
    const tables = new Set<string>();
    const walk = (fn: PythonFunction | undefined, parentId: string, depth: number): void => {
      if (!fn || visited.has(fn.id) || depth > 8) return;
      visited.add(fn.id);
      const kind: AnalysisNode['kind'] = depth === 0 ? 'controller' : /repo|dao|crud/i.test(fn.name + fn.file) ? 'repository' : 'service';
      nodes.push({ id: fn.id, kind, label: fn.name, detail: fn.file, location: { file: fn.file, line: fn.line, endLine: fn.endLine, snippet: snippetAt(fn.body, 1) } });
      edges.push({ source: parentId, target: fn.id, kind: depth === 0 ? 'handles' : 'calls', confidence: depth === 0 ? 'exact' : 'inferred' });
      for (const table of fn.tables) {
        tables.add(table.name);
        const tableId = `table:${table.name}`;
        if (!nodes.some((node) => node.id === tableId)) nodes.push({ id: tableId, kind: 'database', label: table.name });
        edges.push({ source: fn.id, target: tableId, kind: table.mode, confidence: 'inferred' });
      }
      for (const call of fn.calls) walk(byName.get(call)?.[0], fn.id, depth + 1);
    };
    walk(functions.find((fn) => fn.id === raw.fnId) ?? byName.get(raw.handler)?.[0], endpointId, 0);
    return { id: endpointId, framework: raw.framework, method: raw.method, path: raw.path, normalizedPath: normalizeApiPath(raw.path), handler: raw.handler, location: raw.location, frontendCalls: matchingFrontend, tables: [...tables], nodes, edges };
  });
  const unique = [...new Map(endpoints.map((endpoint) => [`${endpoint.method}:${endpoint.normalizedPath}:${endpoint.location.file}`, endpoint])).values()];
  return { rootPath, scannedAt: Date.now(), filesScanned: files.length, pythonFiles: pythonFiles.length, vueFiles: vueFiles.length, endpoints: unique.sort((a, b) => a.path.localeCompare(b.path)), warnings: rawEndpoints.length === 0 ? ['未发现静态可解析的 Python 接口；动态注册的路由暂不支持。'] : [] };
}
