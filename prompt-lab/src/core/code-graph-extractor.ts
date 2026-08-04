import ts from 'typescript';
import type { GraphData, GraphEdge, GraphNode } from '@/plugins/knowledge-graph/graph-types';

export interface CodeDocument { path: string; content: string }

const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function extension(path: string): string {
  const match = path.toLowerCase().match(/\.[^.\\/]+$/);
  return match?.[0] ?? '';
}

function nodeId(path: string, kind: string, name: string): string {
  return `code:${path}:${kind}:${name}`;
}

/** 静态抽取 JS/TS 文件、声明、导入和显式调用关系，不执行用户代码。 */
export function extractCodeGraph(documents: CodeDocument[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const declarations = new Map<string, string[]>();

  const addNode = (id: string, label: string, category: string, sourcePath: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, category, sourcePath, source: 'code', degree: 0 });
  };
  const addEdge = (source: string, target: string, label: string) => {
    if (source !== target && !edges.some((edge) => edge.source === source && edge.target === target && edge.label === label)) {
      edges.push({ source, target, label, weight: 1, kind: 'code' });
    }
  };

  for (const document of documents.filter((item) => SCRIPT_EXTENSIONS.has(extension(item.path)))) {
    const fileId = nodeId(document.path, 'file', document.path);
    addNode(fileId, document.path, '文件', document.path);
    const sourceFile = ts.createSourceFile(document.path, document.content, ts.ScriptTarget.Latest, true,
      ['.tsx', '.jsx'].includes(extension(document.path)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visitDeclarations = (node: ts.Node) => {
      let name: string | undefined;
      let category: string | undefined;
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        name = node.name?.text; category = ts.isClassDeclaration(node) ? '类' : ts.isInterfaceDeclaration(node) ? '接口' : ts.isEnumDeclaration(node) ? '枚举' : '类型';
      } else if (ts.isFunctionDeclaration(node)) { name = node.name?.text; category = '函数'; }
      if (name && category) {
        const id = nodeId(document.path, category, name);
        addNode(id, name, category, document.path);
        addEdge(fileId, id, '定义');
        declarations.set(name, [...(declarations.get(name) ?? []), id]);
      }
      ts.forEachChild(node, visitDeclarations);
    };
    visitDeclarations(sourceFile);
  }

  for (const document of documents.filter((item) => SCRIPT_EXTENSIONS.has(extension(item.path)))) {
    const fileId = nodeId(document.path, 'file', document.path);
    const sourceFile = ts.createSourceFile(document.path, document.content, ts.ScriptTarget.Latest, true,
      ['.tsx', '.jsx'].includes(extension(document.path)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visitRelations = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleName = node.moduleSpecifier.text;
        const moduleId = nodeId(moduleName, 'module', moduleName);
        addNode(moduleId, moduleName, '模块', document.path);
        addEdge(fileId, moduleId, '导入');
      } else if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
        const target = name ? declarations.get(name)?.[0] : undefined;
        if (target) addEdge(fileId, target, '调用');
      } else if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
        const source = declarations.get(node.name.text)?.[0];
        for (const clause of node.heritageClauses ?? []) for (const type of clause.types) {
          const targetName = type.expression.getText(sourceFile);
          const target = declarations.get(targetName)?.[0];
          if (source && target) addEdge(source, target, clause.token === ts.SyntaxKind.ImplementsKeyword ? '实现' : '继承');
        }
      }
      ts.forEachChild(node, visitRelations);
    };
    visitRelations(sourceFile);
  }

  const degree = new Map<string, number>();
  edges.forEach((edge) => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); });
  return { nodes: [...nodes.values()].map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })), edges };
}

export function isSupportedCodePath(path: string): boolean { return SCRIPT_EXTENSIONS.has(extension(path)); }
