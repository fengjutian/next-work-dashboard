import React from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { languageIdFromName } from '@/plugins/code-editor/editor-utils';

loader.config({ monaco });
if (typeof self !== 'undefined') {
  (self as typeof self & { MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') return new JsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
      if (label === 'typescript' || label === 'javascript') return new TsWorker();
      return new EditorWorker();
    },
  };
}

export interface CodeChangeDiffData {
  path: string;
  original: string;
  modified: string;
  loading?: boolean;
  error?: string;
}

export const CodeChangeDiff: React.FC<{
  value: CodeChangeDiffData;
  dark: boolean;
  onClose: () => void;
}> = ({ value, dark, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
    <section className="flex h-[85vh] w-[92vw] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <span className="truncate text-sm font-semibold">{value.path}</span>
        <span className="text-xs text-muted-foreground">监听变化前 ↔ 当前内容</span>
        <div className="flex-1" />
        <span className="text-[10px] text-success">绿色：新增</span>
        <span className="text-[10px] text-destructive">红色：删除</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭比较"><X className="h-4 w-4" /></Button>
      </header>
      <div className="min-h-0 flex-1">
        {value.loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取文件差异…</div>
        ) : value.error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">{value.error}</div>
        ) : (
          <DiffEditor
            original={value.original}
            modified={value.modified}
            language={languageIdFromName(value.path)}
            originalModelPath={`file:///${value.path.replace(/\\/g, '/')}?head`}
            modifiedModelPath={`file:///${value.path.replace(/\\/g, '/')}?workspace`}
            theme={dark ? 'vs-dark' : 'light'}
            options={{ automaticLayout: true, readOnly: true, renderSideBySide: true, renderOverviewRuler: true, minimap: { enabled: false }, lineNumbers: 'on', lineNumbersMinChars: 3, wordWrap: 'on' }}
          />
        )}
      </div>
    </section>
  </div>
);
