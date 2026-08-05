import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, FolderOpen } from '@/components/icons';
import type { KnowledgeDocument } from '@/core/knowledge';
import { buildKnowledgeFolderTree, type KnowledgeFolderNode } from './knowledge-folders';

interface KnowledgeFolderTreeProps {
  documents: KnowledgeDocument[];
  folderPaths?: string[];
  selectedUri: string | null;
  onSelectDocument: (uri: string) => void;
}

const FolderBranch: React.FC<{
  folder: KnowledgeFolderNode;
  depth: number;
  expanded: Set<string>;
  selectedUri: string | null;
  onToggle: (path: string) => void;
  onSelectDocument: (uri: string) => void;
}> = ({ folder, depth, expanded, selectedUri, onToggle, onSelectDocument }) => {
  const isOpen = expanded.has(folder.path);
  return (
    <div>
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-xs hover:bg-accent"
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        aria-expanded={isOpen}
        onClick={() => onToggle(folder.path)}
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{folder.documentCount}</span>
      </button>
      {isOpen && (
        <div>
          {folder.children.map((child) => (
            <FolderBranch key={child.path} folder={child} depth={depth + 1} expanded={expanded} selectedUri={selectedUri} onToggle={onToggle} onSelectDocument={onSelectDocument} />
          ))}
          {folder.documents.map((document) => (
            <button
              type="button"
              key={document.uri}
              className={`flex h-7 w-full items-center gap-1.5 rounded pr-1.5 text-left text-xs hover:bg-accent ${selectedUri === document.uri ? 'bg-accent text-accent-foreground' : ''}`}
              style={{ paddingLeft: `${25 + depth * 14}px` }}
              title={document.path}
              onClick={() => onSelectDocument(document.uri)}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{document.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const KnowledgeFolderTree: React.FC<KnowledgeFolderTreeProps> = ({ documents, folderPaths = [], selectedUri, onSelectDocument }) => {
  const tree = useMemo(() => buildKnowledgeFolderTree(documents, folderPaths), [documents, folderPaths]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));

  useEffect(() => {
    setExpanded((current) => new Set(['', ...tree.children.map((folder) => folder.path), ...current]));
  }, [tree]);

  const toggle = (path: string) => setExpanded((current) => {
    const next = new Set(current);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  return (
    <div className="max-h-56 overflow-auto rounded-md border bg-muted/20 p-1" aria-label="知识库主题文件夹">
      <FolderBranch folder={tree} depth={0} expanded={expanded} selectedUri={selectedUri} onToggle={toggle} onSelectDocument={onSelectDocument} />
      {tree.documentCount === 0 && tree.children.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">暂无 Markdown 文档</p>}
    </div>
  );
};
