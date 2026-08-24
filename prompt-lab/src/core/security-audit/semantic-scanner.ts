import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { findingId, fingerprint, redactSecrets } from './security';
import type { FindingCategory, FindingConfidence, FindingTraceStep, ScanContext, SecurityFinding, SecuritySeverity } from './types';

type FunctionInfo = { name: string; file: string; node: ts.FunctionLikeDeclaration; source: ts.SourceFile; calls: string[] };
type Flow = { expression: ts.Expression; source: ts.Node; sourceLabel: string; path: FindingTraceStep[] };
type SinkRule = { id: string; category: FindingCategory; severity: SecuritySeverity; title: string; cwe: string; recommendation: string; match: (call: ts.CallExpression) => ts.Expression | undefined };

const codeFile = /\.[cm]?[jt]sx?$/i;
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
  if (/^(?:req|request)\.(?:body|query|params|headers|cookies)(?:\.|\[\]|$)/i.test(value)) return `HTTP input: ${value}`;
  if (/^(?:location\.(?:search|hash)|document\.URL|window\.name)$/i.test(value)) return `Browser input: ${value}`;
  if (/^(?:event|ipcEvent)\.senderFrame(?:\.|$)/i.test(value)) return `Electron IPC input: ${value}`;
  if (ts.isCallExpression(node) && /^(?:process\.env|searchParams\.get|URLSearchParams)$/.test(propertyPath(node.expression))) return `External input: ${textOf(node)}`;
  return undefined;
};

const sinks: SinkRule[] = [
  { id: 'taint.command-injection', category: 'sast', severity: 'P0', title: 'Untrusted input reaches command execution', cwe: 'CWE-78', recommendation: 'Use a fixed executable and validated argument array; never compose shell commands from request or IPC data.', match: (call) => /^(?:exec|execSync|child_process\.exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.ssrf', category: 'sast', severity: 'P1', title: 'Untrusted input controls an outbound request', cwe: 'CWE-918', recommendation: 'Parse the URL and enforce an HTTPS host allowlist; reject loopback, private and link-local destinations.', match: (call) => /^(?:fetch|axios(?:\.get|\.post|\.request)?|got|request)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.path-traversal', category: 'sast', severity: 'P1', title: 'Untrusted input reaches a filesystem path', cwe: 'CWE-22', recommendation: 'Resolve the path under an allowed root and verify the resulting relative path cannot escape it.', match: (call) => /^(?:fs\.)?(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|rm|open)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.sql-injection', category: 'sast', severity: 'P0', title: 'Untrusted input reaches a database query', cwe: 'CWE-89', recommendation: 'Use parameterized queries or ORM bindings for every value.', match: (call) => /(?:^|\.)(?:query|execute|raw|exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : undefined },
  { id: 'taint.xss', category: 'sast', severity: 'P1', title: 'Untrusted input reaches an HTML rendering sink', cwe: 'CWE-79', recommendation: 'Render as text or sanitize with a context-aware HTML sanitizer.', match: (call) => /^(?:document\.write|insertAdjacentHTML)$/.test(propertyPath(call.expression)) ? call.arguments.at(-1) : undefined },
];

function frameworkNames(files: Array<{ source: ts.SourceFile; content: string }>): string[] {
  const joined = files.map((item) => item.content).join('\n');
  return [['Express', /from\s+['"]express['"]|require\(['"]express['"]\)/], ['React', /from\s+['"]react['"]|\.tsx?$/], ['Electron IPC', /ipcMain\.|ipcRenderer\.|contextBridge\./], ['Next.js', /from\s+['"]next\//]].filter(([, pattern]) => (pattern as RegExp).test(joined)).map(([name]) => name as string);
}

function makeFinding(rule: SinkRule, sourceFile: ts.SourceFile, sink: ts.Node, flow: Flow, confidence: FindingConfidence): SecurityFinding {
  const location = locationOf(sourceFile, sink); const excerpt = redactSecrets(textOf(sink));
  const key = fingerprint('semantic-analysis', rule.id, location.file, `${location.line}:${excerpt}`); const now = Date.now();
  return { id: findingId(key), fingerprint: key, scannerId: 'semantic-analysis', ruleId: rule.id, category: rule.category, severity: rule.severity, confidence, status: 'open', title: rule.title, description: `${flow.sourceLabel} flows into a security-sensitive operation.`, location, evidence: [{ kind: 'code', excerpt, location }], trace: [...flow.path, { kind: 'sink', label: textOf(sink), location }], recommendation: rule.recommendation, cwe: rule.cwe, firstSeenAt: now, lastSeenAt: now };
}

export function analyzeTypeScriptProject(context: ScanContext): { findings: SecurityFinding[]; frameworks: string[] } {
  const files = context.files.filter((file) => codeFile.test(file)).map((file) => {
    const content = fs.readFileSync(path.join(context.projectDir, file), 'utf8');
    return { content, source: ts.createSourceFile(file.replace(/\\/g, '/'), content, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) };
  });
  const functions = new Map<string, FunctionInfo>();
  for (const { source } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, { name: node.name.text, file: source.fileName, node, source, calls: [] });
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functions.set(node.name.text, { name: node.name.text, file: source.fileName, node: node.initializer, source, calls: [] });
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  for (const info of functions.values()) { const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) { const name = propertyPath(node.expression).split('.').at(-1); if (name && functions.has(name)) info.calls.push(name); } ts.forEachChild(node, visit); }; visit(info.node); }
  const findings: SecurityFinding[] = [];
  for (const { source } of files) {
    const tainted = new Map<string, Flow>();
    const visit = (node: ts.Node, currentFunction?: string): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const direct = sourceLabel(node.initializer); const inherited = ts.isIdentifier(node.initializer) ? tainted.get(node.initializer.text) : undefined;
        if (direct || inherited) tainted.set(node.name.text, direct ? { expression: node.initializer, source: node.initializer, sourceLabel: direct, path: [{ kind: 'source', label: direct, location: locationOf(source, node.initializer) }, { kind: 'propagation', label: node.name.text, location: locationOf(source, node) }] } : { ...inherited!, expression: node.initializer, path: [...inherited!.path, { kind: 'propagation', label: node.name.text, location: locationOf(source, node) }] });
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { const direct = sourceLabel(node.right); const inherited = ts.isIdentifier(node.right) ? tainted.get(node.right.text) : undefined; if (direct || inherited) tainted.set(node.left.text, direct ? { expression: node.right, source: node.right, sourceLabel: direct, path: [{ kind: 'source', label: direct, location: locationOf(source, node.right) }] } : inherited!); }
      if (ts.isCallExpression(node)) for (const rule of sinks) {
        const argument = rule.match(node); if (!argument) continue;
        const direct = sourceLabel(argument); const identifiers: string[] = []; const collect = (child: ts.Node): void => { if (ts.isIdentifier(child)) identifiers.push(child.text); ts.forEachChild(child, collect); }; collect(argument);
        const inherited = identifiers.map((name) => tainted.get(name)).find(Boolean); const flow = direct ? { expression: argument, source: argument, sourceLabel: direct, path: [{ kind: 'source' as const, label: direct, location: locationOf(source, argument) }] } : inherited;
        if (flow) { if (currentFunction) flow.path.push({ kind: 'call', label: currentFunction, location: locationOf(source, node) }); findings.push(makeFinding(rule, source, node, flow, direct ? 'high' : 'medium')); }
      }
      let nextFunction = currentFunction;
      if (ts.isFunctionDeclaration(node) && node.name) nextFunction = node.name.text;
      ts.forEachChild(node, (child) => visit(child, nextFunction));
    }; visit(source);
  }
  return { findings, frameworks: frameworkNames(files) };
}

export const semanticScanner = {
  id: 'semantic-analysis', name: 'TypeScript AST / Data-flow Analysis',
  async detect(context: ScanContext) { return context.files.some((file) => codeFile.test(file)); },
  async scan(context: ScanContext) { return analyzeTypeScriptProject(context).findings; },
};
