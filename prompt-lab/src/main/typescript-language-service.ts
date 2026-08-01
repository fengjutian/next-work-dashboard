import ts from 'typescript';

export interface LanguageServiceLocation { path: string; line: number; column: number; preview: string; kind: 'definition' | 'reference' | 'import' }

export function createTypeScriptSemanticIndex(files: Record<string, string>) {
  const versions = new Map(Object.keys(files).map((name) => [name, '1']));
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: (fileName) => versions.get(fileName) ?? '0',
    getScriptSnapshot: (fileName) => files[fileName] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[fileName]),
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({ allowJs: true, checkJs: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022 }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => files[fileName] !== undefined || ts.sys.fileExists(fileName),
    readFile: (fileName) => files[fileName] ?? ts.sys.readFile(fileName),
    readDirectory: ts.sys.readDirectory,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    search(fileName: string, line: number, column: number): LanguageServiceLocation[] {
      const source = service.getProgram()?.getSourceFile(fileName);
      if (!source) return [];
      const offset = source.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, column - 1));
      const definitions = service.getDefinitionAtPosition(fileName, offset) ?? [];
      const references = (service.findReferences(fileName, offset) ?? []).flatMap((group) => group.references);
      const definitionKeys = new Set(definitions.map((item) => `${item.fileName}:${item.textSpan.start}`));
      const combined = [...definitions.map((item) => ({ ...item, definition: true })), ...references.map((item) => ({ ...item, definition: definitionKeys.has(`${item.fileName}:${item.textSpan.start}`) }))];
      const seen = new Set<string>();
      return combined.flatMap((item) => {
        const key = `${item.fileName}:${item.textSpan.start}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const target = service.getProgram()?.getSourceFile(item.fileName);
        if (!target) return [];
        const position = target.getLineAndCharacterOfPosition(item.textSpan.start);
        const textLine = target.text.split(/\r?\n/)[position.line] ?? '';
        const kind = item.definition ? 'definition' : /^\s*import\b/.test(textLine) ? 'import' : 'reference';
        return [{ path: item.fileName, line: position.line + 1, column: position.character + 1, preview: textLine.trim().slice(0, 240), kind } satisfies LanguageServiceLocation];
      });
    },
    dispose: () => service.dispose(),
  };
}
