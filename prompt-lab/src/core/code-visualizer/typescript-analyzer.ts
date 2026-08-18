import * as ts from 'typescript';
import type { AnalysisDiagnostic, AnalyzerReport, FrontendCall, HttpMethod, RepositorySourceFile } from './types';
import { normalizeApiPath } from './analyzer';

const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

export interface TypeScriptAnalysis {
  calls: FrontendCall[];
  diagnostics: AnalysisDiagnostic[];
  report: AnalyzerReport;
}

/** Extracts frontend HTTP calls with the TypeScript parser. Vue script blocks are parsed independently. */
export function analyzeTypeScriptFiles(files: RepositorySourceFile[]): TypeScriptAnalysis {
  const calls: FrontendCall[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  const failures: AnalyzerReport['failures'] = [];
  let parsedFiles = 0;

  for (const file of files.filter((item) => /\.(?:vue|[cm]?[jt]sx?)$/i.test(item.path))) {
    const sourceText = file.path.endsWith('.vue') ? extractVueScripts(file.content) : file.content;
    if (!sourceText.trim()) continue;
    try {
      const kind = /\.[cm]?tsx?$|\.vue$/i.test(file.path) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
      const source = ts.createSourceFile(file.path, sourceText, ts.ScriptTarget.Latest, true, kind);
      const baseUrls = collectAxiosClients(source);
      visit(source, file, baseUrls);
      parsedFiles += 1;
    } catch (error) {
      failures.push({ file: file.path, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    calls: dedupeCalls(calls),
    diagnostics,
    report: { id: 'typescript-http', language: 'typescript', engine: 'ast', files: parsedFiles, artifacts: calls.length, failures },
  };

  function visit(node: ts.Node, file: RepositorySourceFile, baseUrls: Map<string, string>): void {
    if (ts.isCallExpression(node)) {
      const extracted = extractCall(node, baseUrls);
      if (extracted) {
        const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
        const line = position.line + 1;
        if (extracted.dynamic) {
          diagnostics.push({
            id: `dynamic:${file.path}:${line}`,
            kind: 'dynamic-url',
            severity: 'warning',
            message: `无法静态解析动态请求地址：${extracted.text}`,
            location: { file: file.path, line, snippet: node.getText().slice(0, 240) },
          });
        } else if (extracted.path) {
          calls.push({
            id: `frontend:${file.path}:${line}:${extracted.method}`,
            method: extracted.method,
            path: extracted.path,
            normalizedPath: normalizeApiPath(extracted.path),
            location: { file: file.path, line, snippet: node.getText().slice(0, 240) },
            confidence: 'exact',
            evidence: 'TypeScript AST',
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, file, baseUrls));
  }
}

function collectAxiosClients(source: ts.SourceFile): Map<string, string> {
  const clients = new Map<string, string>([['axios', '']]);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'create' && expression.expression.getText() === 'axios') {
        const config = node.initializer.arguments[0];
        if (config && ts.isObjectLiteralExpression(config)) {
          const baseUrl = propertyString(config, 'baseURL');
          if (baseUrl !== undefined) clients.set(node.name.text, baseUrl);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return clients;
}

function extractCall(node: ts.CallExpression, clients: Map<string, string>): { method: HttpMethod; path?: string; dynamic: boolean; text: string } | null {
  if (node.expression.getText() === 'fetch') {
    const value = staticString(node.arguments[0]);
    const config = node.arguments[1];
    let method: HttpMethod = 'GET';
    if (config && ts.isObjectLiteralExpression(config)) method = asMethod(propertyString(config, 'method')) ?? 'GET';
    return { method, path: value.value, dynamic: value.dynamic, text: node.arguments[0]?.getText() ?? '' };
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const client = node.expression.expression.getText();
    const method = asMethod(node.expression.name.text);
    if (method && (clients.has(client) || /^(?:request|http|api|client)$/i.test(client))) {
      const value = staticString(node.arguments[0]);
      return { method, path: value.value ? joinUrl(clients.get(client) ?? '', value.value) : undefined, dynamic: value.dynamic, text: node.arguments[0]?.getText() ?? '' };
    }
  }
  return null;
}

function staticString(node: ts.Expression | undefined): { value?: string; dynamic: boolean } {
  if (!node) return { dynamic: true };
  if (ts.isStringLiteralLike(node)) return { value: node.text, dynamic: false };
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { value: node.text, dynamic: false };
  if (ts.isTemplateExpression(node)) {
    const value = `${node.head.text}${node.templateSpans.map((span) => `\${${span.expression.getText()}}${span.literal.text}`).join('')}`;
    return { value, dynamic: false };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left); const right = staticString(node.right);
    if (left.value !== undefined && right.value !== undefined) return { value: left.value + right.value, dynamic: left.dynamic || right.dynamic };
  }
  return { dynamic: true };
}

function propertyString(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText().replace(/["']/g, '') === name);
  return property && ts.isPropertyAssignment(property) ? staticString(property.initializer).value : undefined;
}

function asMethod(value?: string): HttpMethod | undefined {
  const method = value?.toUpperCase() as HttpMethod | undefined;
  return method && HTTP_METHODS.has(method) ? method : undefined;
}

function joinUrl(base: string, route: string): string { return `/${[base, route].join('/').split('/').filter(Boolean).join('/')}`; }
function extractVueScripts(content: string): string { return [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join('\n'); }
function dedupeCalls(values: FrontendCall[]): FrontendCall[] { return [...new Map(values.map((item) => [`${item.location.file}:${item.location.line}:${item.method}:${item.path}`, item])).values()]; }
