export type SemanticMatchKind = 'definition' | 'reference' | 'import';
export interface SemanticMatch { path: string; line: number; column: number; preview: string; kind: SemanticMatchKind; symbol: string; importedFrom?: string }

const DEFINITION_PATTERNS = [
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /^\s*(?:def|class)\s+([A-Za-z_][\w]*)/g,
];

export function findSemanticMatches(path: string, content: string, query: string): SemanticMatch[] {
  const symbol = query.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) return [];
  const results: SemanticMatch[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const imports = [...line.matchAll(/(?:import\s+(?:type\s+)?[\s\S]*?from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)];
    const symbolMatcher = new RegExp(`\\b${symbol.replace(/[$]/g, '\\$&')}\\b`);
    if (imports.length && symbolMatcher.test(line)) {
      results.push({ path, line: index + 1, column: Math.max(1, line.indexOf(symbol) + 1), preview: line.trim().slice(0, 240), kind: 'import', symbol, importedFrom: imports[0][1] });
      return;
    }
    const isDefinition = DEFINITION_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return [...line.matchAll(pattern)].some((match) => match[1] === symbol);
    });
    const matcher = new RegExp(`\\b${symbol.replace(/[$]/g, '\\$&')}\\b`, 'g');
    for (const match of line.matchAll(matcher)) {
      results.push({ path, line: index + 1, column: (match.index ?? 0) + 1, preview: line.trim().slice(0, 240), kind: isDefinition ? 'definition' : 'reference', symbol });
      if (isDefinition) break;
    }
  });
  return results;
}
