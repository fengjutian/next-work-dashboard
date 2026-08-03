import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Trash2, FolderOpen, FileText, Calendar, RefreshCw, Search, Copy, X, Loader2 } from '@/components/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile, ConversationSearchResult } from '@/types/electron';
import { conversationMemory } from '@/core/conversation-memory';

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return <>{parts.map((part, index) => part.toLocaleLowerCase() === query.toLocaleLowerCase()
    ? <mark key={index} className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700">{part}</mark>
    : part)}</>;
}

const FileItem: React.FC<{
  file: ConversationFile;
  result?: ConversationSearchResult;
  query: string;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ file, result, query, isActive, onClick, onDelete }) => (
  <div className={`group border-b border-border px-3 py-2 text-xs transition-colors ${
    isActive ? 'bg-primary-light text-primary' : 'text-muted-foreground hover:bg-accent/50'
  }`}>
    <div className="flex cursor-pointer items-start gap-2" onClick={onClick}>
      <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">
          <Highlight text={file.title || file.fileName} query={query} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px]">
          <Calendar className="h-3 w-3" /> {file.date} · {(file.size / 1024).toFixed(1)} KB
          {result && <span className="text-primary">{result.matchCount} 处</span>}
        </div>
        {result?.snippets[0] && (
          <div className="mt-1 line-clamp-2 text-[10px] leading-4" title={`第 ${result.snippets[0].line} 行`}>
            <Highlight text={result.snippets[0].text} query={query} />
          </div>
        )}
      </div>
      <button className="invisible p-0.5 text-muted-foreground hover:text-destructive group-hover:visible"
        onClick={(event) => { event.stopPropagation(); onDelete(); }} title="删除">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  </div>
);

export const ConversationHistory: React.FC = () => {
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeFile, setActiveFile] = useState<ConversationFile | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexStats, setIndexStats] = useState<{ documents: number; chunks: number } | null>(null);
  const { toast } = useToast();
  const conversationSavedAt = useStore((state) => state.conversationSavedAt);
  const memoryConfig = useStore((state) => state.memoryConfig);

  const loadList = useCallback(async () => {
    try { setFiles(await window.electronAPI.listConversations()); }
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

  const selectFile = useCallback(async (file: ConversationFile) => {
    setActiveFile(file); setLoading(true);
    try {
      const result = await window.electronAPI.readConversation(file.path);
      if (!result.success) throw new Error(result.error);
      setContent(result.content || '');
    } catch { setContent(''); toast('读取原文件失败', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  const deleteFile = useCallback(async (file: ConversationFile) => {
    const result = await window.electronAPI.deleteConversation(file.path);
    if (!result.success) { toast('删除失败', 'error'); return; }
    if (activeFile?.path === file.path) { setActiveFile(null); setContent(''); }
    await conversationMemory.removeDocument(file.path);
    toast('已删除', 'success');
    await loadList();
    if (query.trim().length >= 2) setResults(await window.electronAPI.searchConversations(query.trim()));
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
            <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => void loadList()} title="刷新"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => void window.electronAPI.openConversationFolder()} title="打开文件夹"><FolderOpen className="h-3.5 w-3.5" /></button>
          </div>
        </div>
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
        <div className="flex-1 overflow-y-auto">
          {!searching && displayed.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
              <FileText className="h-8 w-8" /><p className="text-xs">{query.trim().length >= 2 ? '没有匹配的知识库文件' : '知识库暂无文件'}</p>
            </div>
          ) : displayed.map(({ file, result }) => <FileItem key={file.path} file={file} result={result} query={query.trim()}
            isActive={activeFile?.path === file.path} onClick={() => void selectFile(file)} onDelete={() => void deleteFile(file)} />)}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-card">
        {activeFile && <div className="flex items-center gap-2 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{activeFile.title || activeFile.fileName}</div>
            <div className="truncate text-[10px] text-muted-foreground" title={activeFile.path}>{activeFile.path}</div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyPath}><Copy className="mr-1 h-3.5 w-3.5" />复制路径</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void revealFile()}><FolderOpen className="mr-1 h-3.5 w-3.5" />显示原文件</Button>
        </div>}
        {activeFile ? loading ? <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4" />加载中</div>
          : <div className="flex-1 overflow-y-auto p-4"><div className="prose prose-sm max-w-none dark:prose-invert"><Markdown remarkPlugins={[remarkGfm]}>{content || '_(空)_'}</Markdown></div></div>
          : <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">选择左侧文件查看完整原文</div>}
      </div>
    </div>
  );
};
