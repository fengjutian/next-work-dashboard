/**
 * MarkdownWorkspaceController — 三栏布局 + 状态栏 + 标签栏。
 *
 * 布局：
 *   ┌──────────────┬────────────────────────────────────────────┬──────────────┐
 *   │ 文件 / 大纲  │  标签栏                                     │ 属性 / 链接   │
 *   │              │  工具栏                                     │              │
 *   │              │  编辑器（Tiptap / Source）                  │              │
 *   │              ├────────────────────────────────────────────┤              │
 *   │              │  状态栏                                     │              │
 *   └──────────────┴────────────────────────────────────────────┴──────────────┘
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, ShieldAlert } from '@/components/icons';
import { useStore } from '@/store';
import { PLUGIN_ID, DEFAULT_PREFERENCES, type MarkdownEditorPreferences } from './constants';
import type { MarkdownDocument } from './types';
import { DocumentsProvider, useDocuments, useActiveDocument } from './hooks/useMarkdownDocuments';
import { useMarkdownPersistence, useWarnOnUnsavedClose, persistRecentDocuments } from './hooks/useMarkdownPersistence';
import { useExternalFileChanges } from './hooks/useExternalFileChanges';
import { MarkdownTabBar } from './components/MarkdownTabBar';
import { MarkdownToolbar, type EditorCommand } from './components/MarkdownToolbar';
import { MarkdownOutline } from './components/MarkdownOutline';
import { MarkdownStatusBar } from './components/MarkdownStatusBar';
import { FrontmatterPanel } from './components/FrontmatterPanel';
import { BacklinksPanel } from './components/BacklinksPanel';
import { MarkdownEditorSurface, type MarkdownEditorSurfaceHandle } from './components/MarkdownEditorSurface';
import { SourceModeSurface } from './components/SourceModeSurface';

function loadPreferences(): MarkdownEditorPreferences {
  try {
    const raw = localStorage.getItem('markdown-editor.preferences.v1');
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(prefs: MarkdownEditorPreferences): void {
  try {
    localStorage.setItem('markdown-editor.preferences.v1', JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export const MarkdownWorkspaceController: React.FC = () => {
  return (
    <DocumentsProvider>
      <MarkdownWorkspaceInner />
    </DocumentsProvider>
  );
};

const MarkdownWorkspaceInner: React.FC = () => {
  const { activeActivity, theme } = useStore();
  const { activeDocument, documents, closeDocument, activate, setMode } = useDocuments();
  const [preferences, setPreferences] = useState<MarkdownEditorPreferences>(loadPreferences);
  const [pendingExternalChange, setPendingExternalChange] = useState<{ id: string; path: string } | null>(null);
  const editorSurfaceRef = useRef<MarkdownEditorSurfaceHandle | null>(null);

  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => persistRecentDocuments(documents), [documents]);
  useWarnOnUnsavedClose(documents);

  const { openFromWorkspace, save } = useMarkdownPersistence({
    activeDocument,
    openDocument: () => undefined,
    applySaveResult: () => undefined,
    markDirty: () => undefined,
  });

  const reloadDocument = useCallback(
    async (doc: MarkdownDocument) => {
      if (!doc.rootPath) return;
      try {
        await openFromWorkspace({ rootPath: doc.rootPath, relativePath: doc.relativePath, source: doc.source });
      } catch {
        /* ignore */
      }
    },
    [openFromWorkspace],
  );

  useExternalFileChanges(documents, {
    onPendingChange: (id, path) => setPendingExternalChange({ id, path }),
    onPendingResolve: (id) => setPendingExternalChange((current) => (current?.id === id ? null : current)),
    reloadDocument,
    discardLocalChanges: (id) => {
      const doc = documents.find((d) => d.id === id);
      if (doc) void reloadDocument(doc);
    },
  });

  // 监听 plugin:file-open
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ pluginId: string; editorId: string; file: { path: string; name: string } }>).detail;
      if (detail?.pluginId !== PLUGIN_ID) return;
      const filePath = detail.file?.path ?? '';
      if (!filePath) return;
      void openFromWorkspace({
        rootPath: extractRootFromFilePath(filePath),
        relativePath: extractRelativeFromFilePath(filePath),
        source: 'external',
      }).catch(() => undefined);
    };
    window.addEventListener('plugin:file-open', handler);
    return () => window.removeEventListener('plugin:file-open', handler);
  }, [openFromWorkspace]);

  const handleCommand = useCallback((command: EditorCommand) => {
    editorSurfaceRef.current?.runCommand(command);
  }, []);

  const handleModeChange = useCallback((mode: 'visual' | 'source') => {
    if (!activeDocument) return;
    setMode(activeDocument.id, mode);
  }, [activeDocument, setMode]);

  // Wiki Link 跳转：Ctrl/Cmd+click 触发
  const handleWikiLinkNavigate = useCallback(async (target: string, _label: string) => {
    // 优先用当前文档的工作区作为上下文
    const rootPath = activeDocument?.rootPath ?? null;
    if (!rootPath) {
      // 外部文件 / 无工作区上下文，提示用户
      window.alert(`无法跳转：当前文档不在工作区中（目标：${target}）`);
      return;
    }
    try {
      const targetPath = target.endsWith('.md') || target.endsWith('.markdown') ? target : `${target}.md`;
      await openFromWorkspace({ rootPath, relativePath: targetPath, source: 'workspace' });
    } catch (err) {
      window.alert(`跳转失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeDocument, openFromWorkspace]);

  return (
    <div className="flex h-full flex-col bg-background" data-plugin={PLUGIN_ID}>
      {pendingExternalChange && (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-3 py-1.5 text-xs text-amber-900">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>外部修改了 {pendingExternalChange.path}。你正在编辑的版本有未保存修改。</span>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-md border border-amber-300 px-2 py-0.5 hover:bg-amber-200"
            onClick={() => {
              const doc = documents.find((d) => d.id === pendingExternalChange.id);
              if (doc) void reloadDocument(doc);
              setPendingExternalChange(null);
            }}
          >重新加载</button>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 hover:bg-amber-200"
            onClick={() => setPendingExternalChange(null)}
          >忽略</button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {preferences.showOutline && (
          <aside className="w-64 flex-shrink-0 border-r bg-muted/30">
            <MarkdownOutline activeDocument={activeDocument} />
          </aside>
        )}
        <main className="flex flex-1 flex-col overflow-hidden">
          <MarkdownTabBar
            documents={documents}
            activeDocumentId={activeDocument?.id ?? null}
            onSelect={activate}
            onClose={closeDocument}
          />
          {activeDocument ? (
            <>
              <MarkdownToolbar
                document={activeDocument}
                onSave={() => { void save(activeDocument); }}
                onModeChange={handleModeChange}
                onCommand={handleCommand}
              />
              <div className="flex-1 overflow-auto">
                {activeDocument.mode === 'visual' ? (
                  <MarkdownEditorSurface
                    ref={editorSurfaceRef}
                    document={activeDocument}
                    preferences={preferences}
                    theme={theme}
                    onSave={(doc) => { void save(doc); }}
                    onWikiLinkNavigate={handleWikiLinkNavigate}
                  />
                ) : (
                  <SourceModeSurface document={activeDocument} onSave={(doc) => { void save(doc); }} />
                )}
              </div>
              <MarkdownStatusBar document={activeDocument} onSave={() => { void save(activeDocument); }} />
            </>
          ) : (
            <EmptyState />
          )}
        </main>
        {(preferences.showFrontmatter || preferences.showBacklinks) && activeDocument && (
          <aside className="w-72 flex-shrink-0 border-l bg-muted/30">
            {preferences.showFrontmatter && <FrontmatterPanel document={activeDocument} />}
            {preferences.showBacklinks && <BacklinksPanel document={activeDocument} />}
          </aside>
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
    <FileText className="mb-3 h-12 w-12 opacity-50" />
    <p className="text-sm">从文件菜单打开 .md，或在左侧工作区选择文件</p>
    <p className="mt-1 text-xs">快捷键：Ctrl/Cmd + O</p>
  </div>
);

function extractRootFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
}

function extractRelativeFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? filePath;
}
