import type { KnowledgeDocument } from '@/core/knowledge';

export interface KnowledgeFolderNode {
  name: string;
  path: string;
  documents: KnowledgeDocument[];
  children: KnowledgeFolderNode[];
  documentCount: number;
}

interface MutableKnowledgeFolder extends Omit<KnowledgeFolderNode, 'children' | 'documentCount'> {
  children: Map<string, MutableKnowledgeFolder>;
}

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });

/** Builds a stable topic tree from workspace-relative Markdown paths. */
export function buildKnowledgeFolderTree(documents: KnowledgeDocument[], folderPaths: string[] = []): KnowledgeFolderNode {
  const root: MutableKnowledgeFolder = { name: '全部文档', path: '', documents: [], children: new Map() };

  const ensureFolder = (folderPath: string) => {
    const folders = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let cursor = root;
    folders.forEach((name) => {
      const path = cursor.path ? `${cursor.path}/${name}` : name;
      let child = cursor.children.get(name);
      if (!child) {
        child = { name, path, documents: [], children: new Map() };
        cursor.children.set(name, child);
      }
      cursor = child;
    });
  };

  folderPaths.forEach(ensureFolder);

  documents.forEach((document) => {
    const segments = document.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const folders = segments.slice(0, -1);
    let cursor = root;

    folders.forEach((name) => {
      const path = cursor.path ? `${cursor.path}/${name}` : name;
      let child = cursor.children.get(name);
      if (!child) {
        child = { name, path, documents: [], children: new Map() };
        cursor.children.set(name, child);
      }
      cursor = child;
    });
    cursor.documents.push(document);
  });

  const finalize = (folder: MutableKnowledgeFolder): KnowledgeFolderNode => {
    const children = [...folder.children.values()].map(finalize).sort(byName);
    const ownDocuments = [...folder.documents].sort((a, b) =>
      a.title.localeCompare(b.title, 'zh-CN', { numeric: true, sensitivity: 'base' }),
    );
    return {
      name: folder.name,
      path: folder.path,
      documents: ownDocuments,
      children,
      documentCount: ownDocuments.length + children.reduce((total, child) => total + child.documentCount, 0),
    };
  };

  return finalize(root);
}
