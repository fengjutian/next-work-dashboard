import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { displayError, type EditorProblem, type EditorSymbol, type OpenDocument } from '../editor-types';

interface UseEditorIntelligenceOptions {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  workspace: { path: string } | null;
  activePath: string | null;
  activeDocument: OpenDocument | null;
  appConfirm: (message: string) => Promise<boolean>;
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
}

export function useEditorIntelligence({
  editorRef, workspace, activePath, activeDocument, appConfirm, setDocuments, setStatus,
}: UseEditorIntelligenceOptions) {
  const [problems, setProblems] = useState<EditorProblem[]>([]);
  const [symbols, setSymbols] = useState<EditorSymbol[]>([]);
  const [position, setPosition] = useState({ line: 1, column: 1 });

  const refreshProblems = useCallback(() => {
    setProblems(monaco.editor.getModels().flatMap((model) => (
      monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
        path: model.uri.path.replace(/^\//, ''),
        message: marker.message,
        line: marker.startLineNumber,
        column: marker.startColumn,
        severity: marker.severity,
      }))
    )));
  }, []);

  const refreshSymbols = useCallback(async (
    editor: monaco.editor.IStandaloneCodeEditor | null = editorRef.current,
  ) => {
    const model = editor?.getModel();
    if (!model) { setSymbols([]); return; }
    if (model.getLanguageId() === 'typescript' || model.getLanguageId() === 'javascript') {
      try {
        const getWorker = model.getLanguageId() === 'typescript'
          ? await monaco.languages.typescript.getTypeScriptWorker()
          : await monaco.languages.typescript.getJavaScriptWorker();
        const worker = await getWorker(model.uri);
        const tree = await worker.getNavigationTree(model.uri.toString());
        if (tree) {
          const entries: EditorSymbol[] = [];
          const visit = (
            item: { text?: string; kind?: string; spans?: Array<{ start: number }>; childItems?: unknown[] },
            depth: number,
          ) => {
            const span = item.spans?.[0];
            if (depth > 0 && item.text && span) {
              const cursor = model.getPositionAt(span.start);
              entries.push({
                name: item.text, detail: item.kind, line: cursor.lineNumber,
                column: cursor.column, depth: depth - 1,
              });
            }
            for (const child of item.childItems ?? []) visit(child as typeof item, depth + 1);
          };
          visit(tree, 0);
          setSymbols(entries);
          return;
        }
      } catch {
        // A language-neutral outline remains available when the worker fails.
      }
    }
    const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|interface|type|enum|function|const|let|var|def|fn|struct)\s+([\w$]+)/;
    const entries: EditorSymbol[] = [];
    for (let line = 1; line <= model.getLineCount(); line += 1) {
      const text = model.getLineContent(line);
      const match = declaration.exec(text);
      if (match) entries.push({
        name: match[2], detail: match[1], line,
        column: Math.max(1, text.indexOf(match[2]) + 1), depth: 0,
      });
    }
    setSymbols(entries);
  }, [editorRef]);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column });
    });
    editor.onMouseDown(async (event) => {
      if (
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        && event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) return;
      const line = event.target.position?.lineNumber;
      if (!line || !workspace || !activeDocument || activeDocument.readOnly) return;
      if (!await appConfirm(`回滚第 ${line} 行的更改？此操作将用 HEAD 版本覆盖该行所在 Hunk。`)) return;
      const revert = await window.electronAPI.workspace.gitShowHead(workspace.path, activeDocument.path);
      if (!revert.success) { setStatus(`回滚失败：${displayError(revert.error)}`); return; }
      setDocuments((previous) => previous.map((document) => document.path === activeDocument.path
        ? { ...document, content: revert.data ?? '', savedContent: revert.data ?? '', externalChanged: false }
        : document));
      setStatus(`已回滚 ${activeDocument.name}`);
    });
    refreshProblems();
    void refreshSymbols(editor);
    editor.focus();
  }, [activeDocument, appConfirm, editorRef, refreshProblems, refreshSymbols, setDocuments, setStatus, workspace]);

  useEffect(() => {
    const disposable = monaco.editor.onDidChangeMarkers(refreshProblems);
    refreshProblems();
    return () => disposable.dispose();
  }, [refreshProblems]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshSymbols(); }, 250);
    return () => window.clearTimeout(timer);
  }, [activeDocument?.content, activePath, refreshSymbols]);

  return { problems, symbols, position, refreshProblems, refreshSymbols, handleMount };
}
