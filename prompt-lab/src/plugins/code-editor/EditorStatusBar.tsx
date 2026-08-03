import React from 'react';
import { encodingLabel, type OpenDocument } from './editor-types';
import { languageFromName } from './editor-utils';

interface Props {
  workspaceName?: string;
  status: string;
  document: OpenDocument | null;
  line: number;
  column: number;
  tabSize: number;
  onOpenSettings: () => void;
}

export const EditorStatusBar: React.FC<Props> = ({
  workspaceName, status, document, line, column, tabSize, onOpenSettings,
}) => <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-primary px-3 text-[11px] text-primary-foreground">
  <span className="max-w-48 truncate">{workspaceName ?? '无工作区'}</span>
  <span className="flex-1 truncate opacity-90">{status}</span>
  {document && <>
    <span>Ln {line}, Col {column}</span>
    <button type="button" onClick={onOpenSettings}>Spaces: {tabSize}</button>
    <span>{encodingLabel(document.encoding)}</span>
    <span>{document.lineEnding}{document.mixedLineEndings ? ' (混合)' : ''}</span>
    {document.readOnly && <span>只读</span>}
    <span>{languageFromName(document.name)}</span>
  </>}
</footer>;
