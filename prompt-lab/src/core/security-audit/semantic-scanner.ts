import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ts from 'typescript';
import { findingId, fingerprint, redactSecrets } from './security';
import type { FindingCategory, FindingConfidence, FindingTraceStep, ScanContext, SecurityFinding, SecuritySeverity } from './types';

type FunctionInfo = { name: string; file: string; node: ts.FunctionLikeDeclaration; source: ts.SourceFile; calls: string[] };
type FunctionSink = { parameterIndex: number; rule: SinkRule; sink: ts.CallExpression; source: ts.SourceFile; callPath: FindingTraceStep[] };
type Flow = { expression: ts.Expression; source: ts.Node; sourceLabel: string; path: FindingTraceStep[] };
type SinkRule = { id: string; category: FindingCategory; severity: SecuritySeverity; title: string; cwe: string; recommendation: string; match: (call: ts.CallExpression) => ts.Expression | undefined };

const codeFile = /\.[cm]?[jt]sx?$/i;
const astCache = new Map<string, { hash: string; source: ts.SourceFile }>();
function cachedSource(file: string, content: string): ts.SourceFile {
  const hash = crypto.createHash('sha256').update(content).digest('hex'); const cached = astCache.get(file); if (cached?.hash === hash) return cached.source;
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind); astCache.set(file, { hash, source });
  if (astCache.size > 2_000) astCache.delete(astCache.keys().next().value as string); return source;
}
const textOf = (node: ts.Node): string => node.getText().replace(/\s+/g, ' ').slice(0, 300);
const locationOf = (source: ts.SourceFile, node: ts.Node) => { const point = source.getLineAndCharacterOfPosition(node.getStart(source)); return { file: source.fileName.replace(/\\/g, '/'), line: point.line + 1, column: point.character + 1 }; };
const propertyPath = (node: ts.Expression): string => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${propertyPath(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node)) return `${propertyPath(node.expression)}[]`;
  return '';
};
const sourceLabel = (node: ts.Expression): string | undefined => {
  const value = propertyPath(node);
  if (/^(?:req|request)\.(?:body|query|params|headers|cookies)(?:\.|\[\]|$)/i.test(value)) return `HTTP 输入：${value}`;
  if (/^(?:location\.(?:search|hash)|document\.URL|window\.name)$/i.test(value)) return `浏览器输入：${value}`;
  if (/^(?:event|ipcEvent)\.senderFrame(?:\.|$)/i.test(value)) return `Electron IPC 输入：${value}`;
  if (ts.isCallExpression(node) && /^(?:process\.env|searchParams\.get|URLSearchParams)$/.test(propertyPath(node.expression))) return `外部输入：${textOf(node)}`;
  return undefined;
};
const sourceInside = (node: ts.Expression): { node: ts.Expression; label: string } | undefined => {
  const direct = sourceLabel(node); if (direct) return { node, label: direct }; let found: { node: ts.Expression; label: string } | undefined;
  ts.forEachChild(node, (child) => { if (!found && ts.isExpression(child)) found = sourceInside(child); }); return found;
};
const inheritedFlow = (node: ts.Expression, tainted: Map<string, Flow>): Flow | undefined => { const names: string[] = []; const collect = (child: ts.Node): void => { if (ts.isIdentifier(child)) names.push(child.text); ts.forEachChild(child, collect); }; collect(node); return names.map((name) => tainted.get(name)).find(Boolean); };
const isSanitized = (node: ts.Expression): boolean => ts.isCallExpression(node) && /^(?:DOMPurify\.sanitize|sanitizeHtml|validator\.escape|encodeURIComponent|path\.basename|[A-Za-z_$][\w$]*Schema\.(?:parse|safeParse))$/.test(propertyPath(node.expression));

const sinks: SinkRule[] = [
  { id: 'taint.command-injection', category: 'sast', severity: 'P0', title: '不可信输入进入命令执行', cwe: 'CWE-78', recommendation: '使用固定的可执行文件和经过校验的参数数组，禁止使用请求或 IPC 数据拼接 Shell 命令。', match: (call) => /^(?:exec|execSync|child_process\.exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.ssrf', category: 'sast', severity: 'P1', title: '不可信输入控制外部网络请求', cwe: 'CWE-918', recommendation: '解析 URL 并执行 HTTPS 主机白名单校验，同时拒绝回环、私有和链路本地地址。', match: (call) => /^(?:fetch|axios(?:\.get|\.post|\.request)?|got|request)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.path-traversal', category: 'sast', severity: 'P1', title: '不可信输入进入文件系统路径', cwe: 'CWE-22', recommendation: '在允许的根目录下解析路径，并验证生成的相对路径不能逃逸根目录。', match: (call) => /^(?:fs\.)?(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|rm|open)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.sql-injection', category: 'sast', severity: 'P0', title: '不可信输入进入数据库查询', cwe: 'CWE-89', recommendation: '所有动态值均应使用参数化查询或 ORM 参数绑定。', match: (call) => /(?:^|\.)(?:query|execute|raw|exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.xss', category: 'sast', severity: 'P1', title: '不可信输入进入 HTML 渲染点', cwe: 'CWE-79', recommendation: '优先按文本渲染；确需 HTML 时，使用与上下文匹配的可靠净化器。', match: (call) => /^(?:document\.write|insertAdjacentHTML)$/.test(propertyPath(call.expression)) ? call.arguments.at(-1) : undefined },
  { id: 'taint.open-redirect', category: 'sast', severity: 'P2', title: '不可信输入控制重定向目标', cwe: 'CWE-601', recommendation: '仅使用相对目标，或对来源和路径执行精确白名单校验。', match: (call) => /(?:^|\.)redirect$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.unsafe-deserialization', category: 'sast', severity: 'P0', title: '不可信输入进入不安全反序列化', cwe: 'CWE-502', recommendation: '使用 JSON 和结构校验，移除可执行对象反序列化。', match: (call) => /(?:^|\.)(?:deserialize|unserialize|load)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.log-injection', category: 'sast', severity: 'P2', title: '不可信输入被写入日志', cwe: 'CWE-117', recommendation: '使用结构化日志，并转义换行符和控制字符。', match: (call) => /^(?:console|logger|log)\.(?:log|info|warn|error)$/.test(propertyPath(call.expression)) ? call.arguments.find((argument) => Boolean(sourceLabel(argument)) || ts.isIdentifier(argument)) : undefined },
];

function frameworkNames(files: Array<{ source: ts.SourceFile; content: string }>): string[] {
  const joined = files.map((item) => item.content).join('\n');
  return [['Express', /from\s+['"]express['"]|require\(['"]express['"]\)/], ['React', /from\s+['"]react['"]|\.tsx?$/], ['Electron IPC', /ipcMain\.|ipcRenderer\.|contextBridge\./], ['Next.js', /from\s+['"]next\//]].filter(([, pattern]) => (pattern as RegExp).test(joined)).map(([name]) => name as string);
}

function makeFinding(rule: SinkRule, sourceFile: ts.SourceFile, sink: ts.Node, flow: Flow, confidence: FindingConfidence): SecurityFinding {
  const location = locationOf(sourceFile, sink); const excerpt = redactSecrets(textOf(sink));
  const key = fingerprint('semantic-analysis', rule.id, location.file, `${location.line}:${excerpt}`); const now = Date.now();
  return { id: findingId(key), fingerprint: key, scannerId: 'semantic-analysis', ruleId: rule.id, category: rule.category, severity: rule.severity, confidence, confidenceRationale: confidence === 'high' ? 'AST 已确认输入源、危险点以及直接或跨函数的数据流路径。' : 'AST 已确认敏感操作，但授权检查或传播路径包含启发式判断。', status: 'open', title: rule.title, description: `${flow.sourceLabel} 流入了安全敏感操作。`, location, evidence: [{ kind: 'code', excerpt, location }], trace: [...flow.path, { kind: 'sink', label: textOf(sink), location }], recommendation: rule.recommendation, cwe: rule.cwe, firstSeenAt: now, lastSeenAt: now };
}

export function analyzeTypeScriptProject(context: ScanContext): { findings: SecurityFinding[]; frameworks: string[] } {
  const files = context.files.filter((file) => codeFile.test(file)).map((file) => {
    const content = fs.readFileSync(path.join(context.projectDir, file), 'utf8');
    const normalized = file.replace(/\\/g, '/'); return { content, source: cachedSource(normalized, content) };
  });
  const functions = new Map<string, FunctionInfo>();
  const functionKey = (file: string, name: string) => `${file}#${name}`;
  for (const { source } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(functionKey(source.fileName, node.name.text), { name: node.name.text, file: source.fileName, node, source, calls: [] });
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functions.set(functionKey(source.fileName, node.name.text), { name: node.name.text, file: source.fileName, node: node.initializer, source, calls: [] });
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  const resolveFunction = (source: ts.SourceFile, expression: ts.LeftHandSideExpression): FunctionInfo | undefined => {
    const localName = propertyPath(expression).split('.').at(-1); if (!localName) return undefined; const local = functions.get(functionKey(source.fileName, localName)); if (local) return local;
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings; if (!bindings || !ts.isNamedImports(bindings)) continue; const element = bindings.elements.find((item) => item.name.text === localName); if (!element) continue;
      const imported = element.propertyName?.text ?? element.name.text; const base = path.posix.normalize(path.posix.join(path.posix.dirname(source.fileName), statement.moduleSpecifier.text));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`]) { const match = functions.get(functionKey(candidate, imported)); if (match) return match; }
    }
    return undefined;
  };
  for (const info of functions.values()) { const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) { const called = resolveFunction(info.source, node.expression); if (called) info.calls.push(`${called.file}#${called.name}`); } ts.forEachChild(node, visit); }; visit(info.node); }
  const functionSinks = new Map<string, FunctionSink[]>();
  for (const info of functions.values()) {
    const parameters = info.node.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : ''); const summaries: FunctionSink[] = [];
    const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) for (const rule of sinks) { const argument = rule.match(node); if (!argument) continue; const names: string[] = []; const collect = (child: ts.Node): void => { if (ts.isIdentifier(child)) names.push(child.text); ts.forEachChild(child, collect); }; collect(argument); const parameterIndex = parameters.findIndex((name) => names.includes(name)); if (parameterIndex >= 0) summaries.push({ parameterIndex, rule, sink: node, source: info.source, callPath: [] }); } ts.forEachChild(node, visit); };
    visit(info.node); if (summaries.length) functionSinks.set(functionKey(info.file, info.name), summaries);
  }
  for (let pass = 0; pass < functions.size; pass += 1) {
    let changed = false;
    for (const info of functions.values()) {
      const parameters = info.node.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : ''); const key = functionKey(info.file, info.name); const summaries = functionSinks.get(key) ?? [];
      const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) { const called = resolveFunction(info.source, node.expression); for (const nested of called ? functionSinks.get(functionKey(called.file, called.name)) ?? [] : []) { const argument = node.arguments[nested.parameterIndex]; if (!argument) continue; const names: string[] = []; const collect = (child: ts.Node): void => { if (ts.isIdentifier(child)) names.push(child.text); ts.forEachChild(child, collect); }; collect(argument); const parameterIndex = parameters.findIndex((name) => names.includes(name)); const duplicate = summaries.some((item) => item.parameterIndex === parameterIndex && item.rule.id === nested.rule.id && item.sink === nested.sink); if (parameterIndex >= 0 && !duplicate) { summaries.push({ ...nested, parameterIndex, callPath: [{ kind: 'call', label: `${called?.name ?? 'callee'}()`, location: locationOf(info.source, node) }, ...nested.callPath] }); changed = true; } } } ts.forEachChild(node, visit); }; visit(info.node); if (summaries.length) functionSinks.set(key, summaries);
    }
    if (!changed) break;
  }
  const findings: SecurityFinding[] = [];
  for (const { source } of files) {
    const visit = (node: ts.Node, currentFunction: string | undefined, tainted: Map<string, Flow>): void => {
      if (ts.isCallExpression(node)) {
        const callName = propertyPath(node.expression); const first = node.arguments[0]; const literal = first && ts.isStringLiteralLike(first) ? first.text.toLowerCase() : '';
        const reportStatic = (rule: SinkRule, rationale: string): void => { const label = rationale; findings.push(makeFinding(rule, source, node, { expression: node, source: node, sourceLabel: label, path: [{ kind: 'source', label, location: locationOf(source, node) }] }, 'high')); };
        if (/^(?:crypto\.)?createHash$/.test(callName) && ['md5', 'sha1'].includes(literal)) reportStatic({ id: 'crypto.weak-hash', category: 'sast', severity: 'P2', title: `使用了弱哈希算法：${literal.toUpperCase()}`, cwe: 'CWE-328', recommendation: '使用 SHA-256 或更强的算法；密码应使用 Argon2id、scrypt 或 bcrypt。', match: () => undefined }, `AST 静态匹配到 createHash('${literal}')`);
        if (/^(?:jwt\.)?verify$/.test(callName) && (node.arguments.length < 3 || !/algorithms\s*:/.test(node.arguments[2]?.getText() ?? ''))) reportStatic({ id: 'auth.jwt-algorithm-not-pinned', category: 'sast', severity: 'P1', title: 'JWT 验证未限定允许的算法', cwe: 'CWE-347', recommendation: '显式传入允许的 JWT 算法白名单，并校验签发方和受众。', match: () => undefined }, 'JWT verify 调用未配置明确的算法白名单');
        if (callName === 'cors' && (!first || literal === '*')) reportStatic({ id: 'config.permissive-cors', category: 'config', severity: 'P2', title: 'CORS 配置过于宽松', cwe: 'CWE-942', recommendation: '仅允许可信来源，且不要将凭据与通配来源组合使用。', match: () => undefined }, 'CORS 中间件未限制允许的来源');
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isSanitized(node.initializer)) { tainted.delete(node.name.text); }
        else {
        const direct = sourceInside(node.initializer); const inherited = inheritedFlow(node.initializer, tainted);
        if (direct) tainted.set(node.name.text, { expression: node.initializer, source: direct.node, sourceLabel: direct.label, path: [{ kind: 'source', label: direct.label, location: locationOf(source, direct.node) }, { kind: 'propagation', label: node.name.text, location: locationOf(source, node) }] });
        else if (inherited) tainted.set(node.name.text, { ...inherited, expression: node.initializer, path: [...inherited.path, { kind: 'propagation', label: node.name.text, location: locationOf(source, node) }] });
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { const direct = sourceInside(node.right); const inherited = inheritedFlow(node.right, tainted); if (direct) tainted.set(node.left.text, { expression: node.right, source: direct.node, sourceLabel: direct.label, path: [{ kind: 'source', label: direct.label, location: locationOf(source, direct.node) }] }); else if (inherited) tainted.set(node.left.text, inherited); }
      if (ts.isCallExpression(node)) for (const rule of sinks) {
        const argument = rule.match(node); if (!argument || isSanitized(argument)) continue;
        const direct = sourceInside(argument); const inherited = inheritedFlow(argument, tainted); const flow = direct ? { expression: argument, source: direct.node, sourceLabel: direct.label, path: [{ kind: 'source' as const, label: direct.label, location: locationOf(source, direct.node) }] } : inherited;
        if (flow) { if (currentFunction) flow.path.push({ kind: 'call', label: currentFunction, location: locationOf(source, node) }); findings.push(makeFinding(rule, source, node, flow, direct ? 'high' : 'medium')); }
      }
      if (ts.isCallExpression(node)) {
        const resolved = resolveFunction(source, node.expression); const callee = resolved?.name; const summaries = resolved ? functionSinks.get(functionKey(resolved.file, resolved.name)) : undefined;
        for (const summary of summaries ?? []) {
          const argument = node.arguments[summary.parameterIndex]; if (!argument) continue; const direct = sourceInside(argument); const inherited = inheritedFlow(argument, tainted);
          const flow = direct ? { expression: argument, source: direct.node, sourceLabel: direct.label, path: [{ kind: 'source' as const, label: direct.label, location: locationOf(source, direct.node) }] } : inherited;
          if (flow) { const callStep = { kind: 'call' as const, label: `${callee}()`, location: locationOf(source, node) }; findings.push(makeFinding(summary.rule, summary.source, summary.sink, { ...flow, path: [...flow.path, callStep, ...summary.callPath] }, 'high')); }
        }
      }
      if (ts.isCallExpression(node) && /^(?:app|router)\.(?:get|post|put|patch|delete)$/.test(propertyPath(node.expression))) {
        const route = node.arguments[0]; const handler = node.arguments.at(-1); const body = handler?.getText() ?? ''; const middleware = node.arguments.slice(1, -1).map(textOf).join(' ');
        if (route && handler && /\b(?:req|request)\.params\b/.test(body) && /\.(?:findOne|findById|findUnique|query|execute)\s*\(/.test(body) && !/(?:auth|session|permission|authorize|owner|userId)/i.test(`${middleware} ${body}`)) {
          const rule: SinkRule = { id: 'framework.express-idor', category: 'sast', severity: 'P1', title: 'Express 对象查询缺少授权检查', cwe: 'CWE-639', recommendation: '校验当前用户是否有权访问目标对象，建议在统一的路由权限中间件中实现。', match: () => undefined };
          const label = `路由参数：${textOf(route)}`; findings.push(makeFinding(rule, source, handler, { expression: route as ts.Expression, source: route, sourceLabel: label, path: [{ kind: 'source', label, location: locationOf(source, route) }] }, 'medium'));
        }
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'dangerouslySetInnerHTML' && node.initializer) {
        const names: string[] = []; const collect = (child: ts.Node): void => { if (ts.isIdentifier(child)) names.push(child.text); ts.forEachChild(child, collect); }; collect(node.initializer); const flow = names.map((name) => tainted.get(name)).find(Boolean);
        if (flow) { const rule: SinkRule = { id: 'framework.react-xss', category: 'sast', severity: 'P1', title: '不可信输入进入 dangerouslySetInnerHTML', cwe: 'CWE-79', recommendation: '避免直接渲染原始 HTML；确有需要时，先使用持续维护的 HTML 净化器处理。', match: () => undefined }; findings.push(makeFinding(rule, source, node, flow, 'high')); }
      }
      let nextFunction = currentFunction; let childScope = tainted;
      if (ts.isFunctionDeclaration(node) && node.name) { nextFunction = node.name.text; childScope = new Map(); }
      else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) childScope = new Map();
      ts.forEachChild(node, (child) => visit(child, nextFunction, childScope));
    }; visit(source, undefined, new Map());
  }
  return { findings, frameworks: frameworkNames(files) };
}

export const semanticScanner = {
  id: 'semantic-analysis', name: 'TypeScript AST / Data-flow Analysis',
  async detect(context: ScanContext) { return context.files.some((file) => codeFile.test(file)); },
  async scan(context: ScanContext) { return analyzeTypeScriptProject(context).findings; },
};
