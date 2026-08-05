import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, FolderOpen, RefreshCw, Search, Copy, X, Loader2, Edit3, Check, Plus, ArrowRight } from '@/components/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MonacoEditor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile, ConversationSearchResult } from '@/types/electron';
import { conversationMemory } from '@/core/conversation-memory';
import { KnowledgeFileList } from '@/components/KnowledgeFileList';

export const ConversationHistory: React.FC = () => {
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showMoveFile, setShowMoveFile] = useState(false);
  const [moveTargetFolder, setMoveTargetFolder] = useState('');
  const [movingFile, setMovingFile] = useState(false);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; file: ConversationFile } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeFile, setActiveFile] = useState<ConversationFile | null>(null);
  const [content, setContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [fileNameDraft, setFileNameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexStats, setIndexStats] = useState<{ documents: number; chunks: number } | null>(null);
  const { toast } = useToast();
  const conversationSavedAt = useStore((state) => state.conversationSavedAt);
  const memoryConfig = useStore((state) => state.memoryConfig);

  const loadList = useCallback(async () => {
    try {
      const [nextFiles, nextFolders] = await Promise.all([
        window.electronAPI.listConversations(),
        window.electronAPI.listConversationFolders(),
      ]);
      setFiles(nextFiles);
      setFolders(nextFolders);
    }
    catch { toast('读取知识库文件列表失败', 'error'); }
  }, [toast]);

  useEffect(() => { void loadList(); }, [loadList, conversationSavedAt]);

  useEffect(() => {
    let active = true;
    if (!memoryConfig.autoIndex) return () => { active = false; };
    conversationMemory.configure(memoryConfig);
    void conversationMemory.sync().then((stats) => {
      if (active) setIndexStats(stats);
    }).catch(() => { /* The manual retry button remains available. */ });
    return () => { active = false; };
  }, [conversationSavedAt, memoryConfig]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try { setResults(await window.electronAPI.searchConversations(normalized)); }
      catch { setResults([]); toast('搜索失败', 'error'); }
      finally { setSearching(false); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, conversationSavedAt, toast]);

  const displayed = useMemo(() => query.trim().length >= 2
    ? results.map((result) => ({ file: result.file, result }))
    : files.map((file) => ({ file, result: undefined })), [files, query, results]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const result = await window.electronAPI.createConversationFolder(name);
      if (!result.success) {
        const message = result.error === 'ALREADY_EXISTS' ? '同名目录已经存在'
          : result.error === 'INVALID_NAME' ? '目录名称包含非法字符' : result.error || '创建失败';
        throw new Error(message);
      }
      setNewFolderName('');
      setShowNewFolder(false);
      await loadList();
      toast(`已创建主题目录：${result.path ?? name}`, 'success');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setCreatingFolder(false); }
  }, [creatingFolder, loadList, newFolderName, toast]);

  const moveActiveFile = useCallback(async () => {
    if (!activeFile || movingFile) return;
    if ((activeFile.folder ?? '') === moveTargetFolder) { setShowMoveFile(false); return; }
    setMovingFile(true);
    const oldPath = activeFile.path;
    try {
      const result = await window.electronAPI.moveConversation(oldPath, moveTargetFolder);
      if (!result.success || !result.filePath) {
        const message = result.error === 'ALREADY_EXISTS' ? '目标目录中已存在同名文件'
          : result.error === 'TARGET_NOT_FOUND' ? '目标目录不存在' : result.error || '移动失败';
        throw new Error(message);
      }
      await conversationMemory.removeDocument(oldPath);
      const nextFiles = await window.electronAPI.listConversations();
      setFiles(nextFiles);
      const moved = nextFiles.find((file) => file.path === result.filePath);
      setActiveFile(moved ?? null);
      setShowMoveFile(false);
      const stats = await conversationMemory.sync();
      setIndexStats(stats);
      useStore.getState().notifyConversationSaved();
      if (query.trim().length >= 2) setResults(await window.electronAPI.searchConversations(query.trim()));
      toast(`已移动到${moveTargetFolder ? `“${moveTargetFolder}”` : '“未分类”'}`, 'success');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setMovingFile(false); }
  }, [activeFile, moveTargetFolder, movingFile, query, toast]);

  const selectFile = useCallback(async (file: ConversationFile) => {
    if (editing && draftContent !== content && !window.confirm('当前修改尚未保存，确定放弃吗？')) return false;
    setActiveFile(file); setLoading(true);
    setEditing(false);
    setRenaming(false);
    try {
      const result = await window.electronAPI.readConversation(file.path);
      if (!result.success) throw new Error(result.error);
      setContent(result.content || '');
      setDraftContent(result.content || '');
      return true;
    } catch { setContent(''); toast('读取原文件失败', 'error'); return false; }
    finally { setLoading(false); }
  }, [content, draftContent, editing, toast]);

  const saveContent = useCallback(async () => {
    if (!activeFile || saving) return;
    setSaving(true);
    try {
      let result: { success: boolean; error?: string };
      try {
        result = await window.electronAPI.writeConversation(activeFile.path, draftContent);
      } catch (error) {
        // During Electron Forge hot reload the renderer/preload can be newer than
        // the still-running main process. Reuse the established text writer until restart.
        if (!String(error).includes("No handler registered for 'write-conversation'")) throw error;
        result = await window.electronAPI.writeTextFile(activeFile.path, draftContent);
      }
      if (!result.success) throw new Error(result.error || '保存失败');
      setContent(draftContent);
      setEditing(false);
      await conversationMemory.removeDocument(activeFile.path);
      const stats = await conversationMemory.sync();
      setIndexStats(stats);
      useStore.getState().notifyConversationSaved();
      await loadList();
      toast('原文已保存，知识库索引已更新', 'success');
    } catch (error) {
      toast(`保存失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [activeFile, draftContent, loadList, saving, toast]);

  const cancelEditing = useCallback(() => {
    setDraftContent(content);
    setEditing(false);
  }, [content]);

  const beginRename = useCallback(() => {
    if (!activeFile) return;
    setFileNameDraft(activeFile.fileName.replace(/\.md$/i, ''));
    setRenaming(true);
  }, [activeFile]);

  const saveFileName = useCallback(async () => {
    if (!activeFile || renameSaving || !fileNameDraft.trim()) return;
    const oldPath = activeFile.path;
    setRenameSaving(true);
    try {
      let requestedName = fileNameDraft.trim();
      if (!requestedName.toLowerCase().endsWith('.md')) requestedName += '.md';
      const stem = requestedName.slice(0, -3);
      if (!stem || requestedName.length > 180 || /[<>:"/\\|?*\u0000-\u001f]/.test(requestedName)
        || /[. ]\.md$/i.test(requestedName)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(requestedName)) {
        throw new Error('文件名包含非法字符或格式不正确');
      }
      let result: { success: boolean; filePath?: string; error?: string };
      try {
        result = await window.electronAPI.renameConversation(oldPath, requestedName);
      } catch (error) {
        if (!String(error).includes("No handler registered for 'rename-conversation'")) throw error;
        const separator = Math.max(oldPath.lastIndexOf('\\'), oldPath.lastIndexOf('/'));
        const targetPath = `${oldPath.slice(0, separator + 1)}${requestedName}`;
        const existingFiles = await window.electronAPI.listConversations();
        const collision = existingFiles.some((file) => file.path.toLocaleLowerCase() === targetPath.toLocaleLowerCase()
          && file.path.toLocaleLowerCase() !== oldPath.toLocaleLowerCase());
        if (collision) {
          result = { success: false, error: 'ALREADY_EXISTS' };
        } else if (targetPath.toLocaleLowerCase() === oldPath.toLocaleLowerCase()) {
          result = { success: false, error: '主进程重启后才能修改文件名大小写' };
        } else {
          const write = await window.electronAPI.writeTextFile(targetPath, content);
          if (!write.success) {
            result = { success: false, error: write.error || 'WRITE_FAILED' };
          } else {
            const remove = await window.electronAPI.deleteConversation(oldPath);
            result = remove.success
              ? { success: true, filePath: targetPath }
              : { success: false, error: `新文件已创建，但旧文件删除失败：${remove.error || '未知错误'}` };
          }
        }
      }
      if (!result.success || !result.filePath) {
        const message = result.error === 'ALREADY_EXISTS' ? '同名文件已经存在'
          : result.error === 'INVALID_NAME' ? '文件名包含非法字符或格式不正确'
            : result.error || '重命名失败';
        throw new Error(message);
      }
      await conversationMemory.removeDocument(oldPath);
      const nextFiles = await window.electronAPI.listConversations();
      setFiles(nextFiles);
      const renamed = nextFiles.find((file) => file.path === result.filePath);
      if (renamed) setActiveFile(renamed);
      setRenaming(false);
      const stats = await conversationMemory.sync();
      setIndexStats(stats);
      useStore.getState().notifyConversationSaved();
      if (query.trim().length >= 2) setResults(await window.electronAPI.searchConversations(query.trim()));
      toast('文件名已修改，知识库索引已更新', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setRenameSaving(false);
    }
  }, [activeFile, content, fileNameDraft, query, renameSaving, toast]);

  const deleteFile = useCallback(async (file: ConversationFile) => {
    setDeleting(true);
    try {
      const result = await window.electronAPI.deleteConversation(file.path);
      if (!result.success) { toast('删除失败', 'error'); return; }
      if (activeFile?.path === file.path) { setActiveFile(null); setContent(''); setEditing(false); }
      await conversationMemory.removeDocument(file.path);
      setDeleteTarget(null);
      toast('知识库文件已删除', 'success');
      await loadList();
      if (query.trim().length >= 2) setResults(await window.electronAPI.searchConversations(query.trim()));
    } finally {
      setDeleting(false);
    }
  }, [activeFile, loadList, query, toast]);

  const revealFile = useCallback(async () => {
    if (!activeFile) return;
    const result = await window.electronAPI.revealConversation(activeFile.path);
    if (!result.success) toast('无法定位原文件', 'error');
  }, [activeFile, toast]);

  const copyPath = useCallback(() => {
    if (!activeFile) return;
    window.electronAPI.copyText(activeFile.path);
    toast('文件路径已复制', 'success');
  }, [activeFile, toast]);

  const totalMatches = results.reduce((sum, result) => sum + result.matchCount, 0);

  const rebuildIndex = useCallback(async () => {
    setIndexing(true);
    try {
      const stats = await conversationMemory.sync();
      setIndexStats(stats);
      toast(`已索引 ${stats.documents} 个文件、${stats.chunks} 个片段`, 'success');
    } catch { toast('知识库索引失败', 'error'); }
    finally { setIndexing(false); }
  }, [toast]);

  return (
    <div className="flex h-full">
      <div className="flex w-72 flex-shrink-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground">知识库 ({files.length})</span>
          <div className="flex gap-1">
            <button className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setShowNewFolder((value) => !value)} title="新建主题目录">
              <Plus className="h-3.5 w-3.5" />新建目录
            </button>
            <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => void loadList()} title="刷新"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => void window.electronAPI.openConversationFolder()} title="打开文件夹"><FolderOpen className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {showNewFolder && <div className="flex gap-1 border-b p-2">
          <input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(); if (event.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
            placeholder="主题目录名称" className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs outline-none focus:border-primary" />
          <Button size="sm" className="h-8 px-2 text-xs" disabled={!newFolderName.trim() || creatingFolder} onClick={() => void createFolder()}>
            {creatingFolder ? <Loader2 className="h-3.5 w-3.5" /> : '添加'}
          </Button>
        </div>}
        <div className="border-b p-2">
          <div className="flex items-center gap-1.5 rounded-md border bg-card px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、备注和知识库内容"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" />
            {searching ? <Loader2 className="h-3.5 w-3.5" /> : query && <button onClick={() => setQuery('')}><X className="h-3.5 w-3.5" /></button>}
          </div>
          {query.trim().length === 1 && <p className="mt-1 text-[10px] text-muted-foreground">再输入 1 个字符开始搜索</p>}
          {query.trim().length >= 2 && !searching && <p className="mt-1 text-[10px] text-muted-foreground">找到 {totalMatches} 处结果 / {results.length} 个文件</p>}
          <div className="mt-2 flex items-center justify-between rounded bg-muted/50 px-2 py-1.5 text-[10px] text-muted-foreground">
            <span>{indexStats ? `知识库：${indexStats.documents} 文件 / ${indexStats.chunks} 片段` : '知识库尚未索引'}</span>
            <button className="text-primary disabled:opacity-50" disabled={indexing} onClick={() => void rebuildIndex()}>
              {indexing ? '索引中…' : indexStats ? '更新索引' : '构建索引'}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {!searching && <KnowledgeFileList
            files={query.trim().length >= 2 ? displayed.map((item) => item.file) : files}
            folders={folders}
            query={query.trim()}
            searchResults={query.trim().length >= 2 ? results : undefined}
            activePath={activeFile?.path}
            onOpen={(file) => void selectFile(file)}
            onDelete={setDeleteTarget}
            onContextMenu={(event, file) => { event.preventDefault(); setFileMenu({ x: event.clientX, y: event.clientY, file }); }}
            emptyMessage={query.trim().length >= 2 ? '没有匹配的知识库文件' : '知识库暂无文件'}
          />}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-card">
        {activeFile && <div className="flex items-center gap-2 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            {renaming ? <div className="flex max-w-md items-center gap-1.5">
              <input value={fileNameDraft} onChange={(event) => setFileNameDraft(event.target.value)} autoFocus
                onKeyDown={(event) => { if (event.key === 'Enter') void saveFileName(); if (event.key === 'Escape') setRenaming(false); }}
                className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:border-primary" />
              <span className="text-xs text-muted-foreground">.md</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={renameSaving} onClick={() => setRenaming(false)} title="取消"><X className="h-3.5 w-3.5" /></Button>
              <Button size="icon" className="h-7 w-7" disabled={renameSaving || !fileNameDraft.trim()} onClick={() => void saveFileName()} title="保存文件名">
                {renameSaving ? <Loader2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
            </div> : <div className="flex min-w-0 items-center gap-1">
              <div className="truncate text-xs font-medium">{activeFile.fileName}</div>
              <button className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={beginRename} title="修改文件名"><Edit3 className="h-3 w-3" /></button>
            </div>}
            <div className="truncate text-[10px] text-muted-foreground" title={activeFile.path}>{activeFile.path}</div>
          </div>
          {showMoveFile && <div className="flex shrink-0 items-center gap-1 rounded-md border bg-background p-1">
            <select autoFocus value={moveTargetFolder} onChange={(event) => setMoveTargetFolder(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void moveActiveFile(); if (event.key === 'Escape') setShowMoveFile(false); }}
              className="h-6 max-w-40 rounded border-0 bg-transparent px-1 text-xs outline-none">
              <option value="">未分类（根目录）</option>
              {folders.map((folder) => <option key={folder.path} value={folder.path}>{folder.path}</option>)}
            </select>
            <Button size="sm" className="h-6 px-2 text-[11px]" disabled={movingFile || moveTargetFolder === (activeFile.folder ?? '')} onClick={() => void moveActiveFile()}>
              {movingFile ? <Loader2 className="h-3 w-3" /> : '确定'}
            </Button>
            <button className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => setShowMoveFile(false)} title="取消"><X className="h-3 w-3" /></button>
          </div>}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setMoveTargetFolder(activeFile.folder ?? ''); setShowMoveFile((value) => !value); }}>
            <ArrowRight className="mr-1 h-3.5 w-3.5" />移动到
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyPath}><Copy className="mr-1 h-3.5 w-3.5" />复制路径</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void revealFile()}><FolderOpen className="mr-1 h-3.5 w-3.5" />显示原文件</Button>
          {editing ? <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={cancelEditing}><X className="mr-1 h-3.5 w-3.5" />取消</Button>
            <Button size="sm" className="h-7 px-2 text-xs" disabled={saving || draftContent === content} onClick={() => void saveContent()}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5" /> : <Check className="mr-1 h-3.5 w-3.5" />}保存
            </Button>
          </> : <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}><Edit3 className="mr-1 h-3.5 w-3.5" />编辑</Button>}
        </div>}
        {activeFile ? loading ? <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4" />加载中</div>
          : editing
            ? <div className="flex min-h-0 flex-1 flex-col">
              <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
                <div className="flex min-h-0 flex-col">
                  <div className="border-b px-3 py-1.5 text-[10px] font-medium text-muted-foreground">Markdown 源码</div>
                  <div className="min-h-0 flex-1">
                    <MonacoEditor
                      path={`knowledge://${activeFile.path.replace(/\\/g, '/')}`}
                      language="markdown"
                      value={draftContent}
                      theme={document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'}
                      onChange={(value) => setDraftContent(value ?? '')}
                      options={{
                        automaticLayout: true,
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        lineNumbers: 'on',
                        fontSize: 13,
                        lineHeight: 21,
                        padding: { top: 10, bottom: 10 },
                        scrollBeyondLastLine: false,
                        renderWhitespace: 'selection',
                      }}
                    />
                  </div>
                </div>
                <div className="flex min-h-0 flex-col">
                  <div className="border-b px-3 py-1.5 text-[10px] font-medium text-muted-foreground">实时预览</div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <Markdown remarkPlugins={[remarkGfm]}>{draftContent || '_(空)_'}</Markdown>
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t px-3 py-1 text-right text-[10px] text-muted-foreground">{draftContent.length} 字符 · Markdown</div>
            </div>
            : <div className="flex-1 overflow-y-auto p-4"><div className="prose prose-sm max-w-none dark:prose-invert"><Markdown remarkPlugins={[remarkGfm]}>{content || '_(空)_'}</Markdown></div></div>
          : <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">选择左侧文件查看完整原文</div>}
      </div>
      {fileMenu && createPortal(
        <div className="fixed inset-0 z-[180]" onMouseDown={() => setFileMenu(null)} onContextMenu={(event) => { event.preventDefault(); setFileMenu(null); }}>
          <div role="menu" aria-label={`${fileMenu.file.fileName} 操作`} className="fixed w-48 overflow-hidden rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-xl"
            style={{ left: Math.min(fileMenu.x, window.innerWidth - 208), top: Math.min(fileMenu.y, window.innerHeight - 270) }} onMouseDown={(event) => event.stopPropagation()}>
            <button role="menuitem" className="flex w-full items-center justify-between px-3 py-1.5 text-left font-medium hover:bg-accent" onClick={() => { void selectFile(fileMenu.file); setFileMenu(null); }}>
              打开 <span className="text-[10px] font-normal text-muted-foreground">Enter</span>
            </button>
            <div className="my-1 border-t" />
            <button role="menuitem" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => {
              const file = fileMenu.file; setFileMenu(null); void selectFile(file).then((selected) => { if (selected) { setFileNameDraft(file.fileName.replace(/\.md$/i, '')); setRenaming(true); } });
            }}>重命名…</button>
            <button role="menuitem" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => {
              const file = fileMenu.file; setFileMenu(null); void selectFile(file).then((selected) => { if (selected) { setMoveTargetFolder(file.folder ?? ''); setShowMoveFile(true); } });
            }}>移动到…</button>
            <div className="my-1 border-t" />
            <button role="menuitem" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { void window.electronAPI.revealConversation(fileMenu.file.path); setFileMenu(null); }}>在文件管理器中显示</button>
            <button role="menuitem" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { window.electronAPI.copyText(fileMenu.file.path); toast('文件路径已复制', 'success'); setFileMenu(null); }}>复制完整路径</button>
            <div className="my-1 border-t" />
            <button role="menuitem" className="w-full px-3 py-1.5 text-left text-destructive hover:bg-accent" onClick={() => { setDeleteTarget(fileMenu.file); setFileMenu(null); }}>删除文件…</button>
          </div>
        </div>,
        document.body,
      )}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-knowledge-title"
            className="w-full max-w-md overflow-hidden rounded-xl border bg-card shadow-2xl">
            <div className="flex gap-3 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="delete-knowledge-title" className="text-sm font-semibold text-foreground">删除知识库文件？</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">文件及其知识库索引将被永久移除，此操作无法撤销。</p>
                <div className="mt-3 break-all rounded-md border bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
                  {deleteTarget.title || deleteTarget.fileName}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
              <Button variant="outline" size="sm" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void deleteFile(deleteTarget)}>
                {deleting ? <Loader2 className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
