import fs from 'node:fs';
import ts from 'typescript';
import type { KnowledgeDiagnostic, KnowledgeDocument } from '../core/knowledge';
import { resolveWorkspacePath } from './workspace/path';

interface MermaidBlock { content: string; line: number; closed: boolean }

export function extractMermaidBlocks(content: string): MermaidBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: MermaidBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*```mermaid\s*$/i.test(lines[index])) continue;
    const start = index;
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) { body.push(lines[index]); index += 1; }
    blocks.push({ content: body.join('\n'), line: start + 1, closed: index < lines.length });
  }
  return blocks;
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 300) ?? '未知 Mermaid 语法错误';
}

function mermaidErrorLine(error: unknown, fenceLine: number, contentLineCount: number): number {
  const message = error instanceof Error ? error.message : String(error);
  const relativeLine = Number(message.match(/(?:parse error on|at)?\s*line\s+(\d+)/i)?.[1] ?? 0);
  return relativeLine > 0 ? fenceLine + Math.min(relativeLine, contentLineCount) : fenceLine;
}

export async function validateMermaid(content: string, documentPath: string): Promise<KnowledgeDiagnostic[]> {
  const blocks = extractMermaidBlocks(content);
  if (!blocks.length) return [];
  const mermaid = (await import('mermaid')).default;
  const diagnostics: KnowledgeDiagnostic[] = [];
  for (const block of blocks) {
    if (!block.closed) {
      diagnostics.push({ severity: 'error', code: 'MERMAID_FENCE_UNCLOSED', message: `Mermaid 代码块未闭合（第 ${block.line} 行）`, path: documentPath, line: block.line });
      continue;
    }
    if (!block.content.trim()) {
      diagnostics.push({ severity: 'error', code: 'MERMAID_EMPTY', message: `Mermaid 代码块为空（第 ${block.line} 行）`, path: documentPath, line: block.line });
      continue;
    }
    try { await mermaid.parse(block.content); }
    catch (error) {
      const line = mermaidErrorLine(error, block.line, block.content.split(/\r?\n/).length);
      diagnostics.push({ severity: 'error', code: 'MERMAID_SYNTAX_ERROR', message: `Mermaid 语法错误（第 ${line} 行）：${errorSummary(error)}`, path: documentPath, line });
    }
  }
  return diagnostics;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function declarationNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function ipcChannels(sourceFile: ts.SourceFile): Set<string> {
  const channels = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['handle', 'on', 'invoke', 'send'].includes(node.expression.name.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) channels.add(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return channels;
}

export function validateDeclaredSymbols(rootPath: string, document: KnowledgeDocument): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  for (const reference of list(document.frontmatter.symbols)) {
    const separator = reference.lastIndexOf('#');
    if (separator <= 0 || separator === reference.length - 1) {
      diagnostics.push({ severity: 'error', code: 'SYMBOL_REFERENCE_INVALID', message: `源码符号引用格式无效：${reference}`, path: document.path });
      continue;
    }
    const sourcePath = reference.slice(0, separator).replace(/\\/g, '/');
    const symbol = reference.slice(separator + 1);
    let absolutePath: string;
    try { absolutePath = resolveWorkspacePath(rootPath, sourcePath); }
    catch {
      diagnostics.push({ severity: 'error', code: 'SYMBOL_SOURCE_MISSING', message: `源码符号文件不存在或越界：${sourcePath}`, path: document.path });
      continue;
    }
    if (!fs.statSync(absolutePath).isFile()) {
      diagnostics.push({ severity: 'error', code: 'SYMBOL_SOURCE_MISSING', message: `源码符号文件不存在：${sourcePath}`, path: document.path });
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    const scriptKind = /\.tsx$/i.test(sourcePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(sourcePath) ? ts.ScriptKind.JSX : /\.js$/i.test(sourcePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const found = /^[A-Za-z_$][\w$]*$/.test(symbol) ? declarationNames(sourceFile).has(symbol) : ipcChannels(sourceFile).has(symbol);
    if (!found) diagnostics.push({ severity: 'warning', code: 'SYMBOL_NOT_FOUND', message: `源码符号不存在：${reference}`, path: document.path });
  }
  return diagnostics;
}
