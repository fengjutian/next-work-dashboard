import React from 'react';
import { Code, X } from '../../components/icons';
import { Button } from '../../components/ui/button';
import type { OpenDocument } from './editor-types';

interface Props {
  documents: OpenDocument[];
  activeDocument: OpenDocument | null;
  activePath: string | null;
  workspaceOpen: boolean;
  onActivate: (path: string) => void;
  onPin: (path: string) => void;
  onClose: (path: string) => void;
  onTabMenu: (x: number, y: number, path: string) => void;
  onMoveTab: (source: string, target: string) => void;
  onReload: (document: OpenDocument) => void;
  onCompare: (document: OpenDocument) => void;
  onForceSave: (document: OpenDocument) => void;
}

export const EditorDocumentHeader: React.FC<Props> = ({
  documents, activeDocument, activePath, workspaceOpen, onActivate, onPin,
  onClose, onTabMenu, onMoveTab, onReload, onCompare, onForceSave,
}) => <>
  {documents.length > 0 && <div className="flex h-9 shrink-0 overflow-x-auto border-b bg-muted/40">
    {documents.map((document) => {
      const dirty = document.content !== document.savedContent;
      const active = document.path === activePath;
      return <button type="button" key={document.path} className={`group flex min-w-0 max-w-52 items-center gap-2 border-r px-3 text-xs ${active ? 'border-t-2 border-t-primary bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`} onClick={() => onActivate(document.path)} onDoubleClick={() => onPin(document.path)} onContextMenu={(event) => { event.preventDefault(); onTabMenu(event.clientX, event.clientY, document.path); }} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-nwd-tab-path', document.path)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onMoveTab(event.dataTransfer.getData('application/x-nwd-tab-path'), document.path); }} title={document.path}>
        <Code className="h-3.5 w-3.5 shrink-0" />
        <span className={`truncate ${document.pinned === false ? 'italic' : ''}`}>{document.name}</span>
        <span role="button" tabIndex={0} className={`shrink-0 rounded p-0.5 hover:bg-muted ${dirty ? '' : 'opacity-0 group-hover:opacity-100'}`} onClick={(event) => { event.stopPropagation(); onClose(document.path); }} onKeyDown={(event) => { if (event.key === 'Enter') onClose(document.path); }} aria-label={`关闭 ${document.name}${dirty ? '，未保存' : ''}`}>
          {dirty ? <span className="block h-2 w-2 rounded-full bg-foreground/70 group-hover:hidden" /> : null}
          <X className={`h-3 w-3 ${dirty ? 'hidden group-hover:block' : ''}`} />
        </span>
      </button>;
    })}
  </div>}
  {activeDocument?.externalChanged && <div className="flex h-9 shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 text-xs">
    <span className="flex-1 truncate">该文件已在外部修改，本地编辑内容尚未保存。</span>
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onReload(activeDocument)}>重新加载</Button>
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onCompare(activeDocument)}>比较</Button>
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onForceSave(activeDocument)}>覆盖保存</Button>
  </div>}
  {activeDocument?.missing && <div className="flex h-9 shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 text-xs">
    <span className="flex-1 truncate">该文件已在外部删除或重命名，当前内容以只读方式保留。</span>
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onClose(activeDocument.path)}>关闭标签</Button>
  </div>}
  {activeDocument && <nav className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b px-3 text-[11px] text-muted-foreground" aria-label="Breadcrumb">
    {(workspaceOpen ? activeDocument.path.split(/[\\/]/) : [activeDocument.name]).map((part, index, parts) => <React.Fragment key={`${part}:${index}`}>
      {index > 0 && <span className="opacity-50">›</span>}
      <span className={index === parts.length - 1 ? 'text-foreground' : ''}>{part}</span>
    </React.Fragment>)}
  </nav>}
</>;
