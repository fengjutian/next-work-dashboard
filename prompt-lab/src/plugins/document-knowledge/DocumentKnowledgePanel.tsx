import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Database, FileText, Loader2, PanelLeft, PanelRight, RefreshCw, Send, Trash2, Upload } from '@/components/icons';
import type { RagWorkerIndexStatus } from '@/types/electron';
import { dbDeleteDocumentKnowledge, dbLoadDocumentKnowledge, dbSaveDocumentKnowledge, dbTouchDocumentKnowledge, flushDbToDisk, isDbReady } from '@/db';
import { createOpenAIProvider } from '@/core/llm';
import { useStore } from '@/store';
import { toast } from '@/components/Toast';
import { indexDocument, embedQuestion, reembedDocumentChunks } from './pipeline';
import type { EmbeddingMode } from './pipeline';
import { buildRagContext, prepareRetrievalHits, retrieve } from './retrieval';
import { isSupportedDocument } from './parser';
import type { DocumentChunk, ParsedDocument, RagMessage } from './types';
import { previewParagraphs } from './preview';

type Stage = 'idle' | 'indexing' | 'ready' | 'asking' | 'error';
const PANE_PREFS_KEY = 'document-knowledge.panes.v1';
const RAG_PARSER_VERSION = 'document-knowledge-parser-v1';
const RAG_CHUNKER_VERSION = 'character-overlap-v2-cjk-fts';

function embeddingIdentity(mode: EmbeddingMode, memoryConfig: ReturnType<typeof useStore.getState>['memoryConfig']): string {
  if (mode === 'remote-semantic') return `remote:${memoryConfig.embeddingBaseUrl}:${memoryConfig.embeddingModel}`;
  if (mode === 'local-semantic') return `local:${memoryConfig.localEmbeddingModel}`;
  return 'hash-fallback:512:v1';
}

async function syncRustRagDocument(document: ParsedDocument, chunks: DocumentChunk[], modelId: string, force = false): Promise<boolean> {
  try {
    const status = await window.electronAPI.ragWorker.status();
    if (!status.available) return false;
    await window.electronAPI.ragWorker.upsertDocument({
      id: document.id,
      name: document.name,
      kind: document.kind,
      sourcePath: document.cachedFilePath,
      fileSize: document.size,
      parserVersion: RAG_PARSER_VERSION,
      chunkerVersion: RAG_CHUNKER_VERSION,
      embeddingIdentity: modelId,
      force,
      chunks: chunks.map((chunk, chunkIndex) => ({
        id: chunk.id,
        content: chunk.content,
        chunkIndex,
        sectionTitle: chunk.sectionTitle,
        page: chunk.page,
        vector: chunk.vector,
      })),
    });
    return true;
  } catch (error) {
    console.warn('[DocumentKnowledge] Rust RAG shadow indexing unavailable; using legacy index.', error);
    return false;
  }
}

async function hybridRetrieve(chunks: DocumentChunk[], query: string, vector: number[], modelId: string, options: {
  limit: number; minScore: number; maxPerDocument: number; contextBudget: number;
}) {
  const { limit } = options;
  const legacyVectorCandidates = retrieve(chunks, vector, Math.max(50, limit * 10));
  try {
    const lanceMatches = await window.electronAPI.ragWorker.vectorSearch({ vector, modelId, topK: Math.max(50, limit * 10) });
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const lanceCandidates = lanceMatches.flatMap((match) => {
      const chunk = byId.get(match.id);
      return chunk ? [{ ...chunk, score: Math.max(0, 1 - match.distance) }] : [];
    });
    const vectorCandidates = lanceCandidates.length ? lanceCandidates : legacyVectorCandidates;
    const lexical = await window.electronAPI.ragWorker.keywordSearch({ query, topK: Math.max(50, limit * 10) });
    const lexicalScores = new Map(lexical.hits.map((hit) => [hit.chunkId, hit.score]));
    const fused = await window.electronAPI.ragWorker.fuseResults({
      lists: [
        { ids: vectorCandidates.map((hit) => hit.id) },
        { ids: lexical.hits.map((hit) => hit.chunkId) },
      ],
      topK: Math.max(30, limit * 5),
      rankConstant: 60,
    });
    const vectorScores = new Map(vectorCandidates.map((hit) => [hit.id, hit.score]));
    const hits = fused.hits.flatMap((hit) => {
      const chunk = byId.get(hit.chunkId);
      return chunk ? [{ ...chunk, score: vectorScores.get(chunk.id) ?? Math.min(1, hit.score * 60),
        retrievalScores: { vector: vectorScores.get(chunk.id), lexical: lexicalScores.get(chunk.id), fused: hit.score } }] : [];
    });
    return prepareRetrievalHits(hits.length ? hits : vectorCandidates, options);
  } catch (error) {
    console.warn('[DocumentKnowledge] Rust hybrid retrieval unavailable; using vector search.', error);
    return prepareRetrievalHits(legacyVectorCandidates, options);
  }
}

export const DocumentKnowledgePanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const memoryConfig = useStore((state) => state.memoryConfig);
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [status, setStatus] = useState('上传 PDF 或 Office 文件开始');
  const [progress, setProgress] = useState(0);
  const [embeddingMode, setEmbeddingMode] = useState<EmbeddingMode>();
  const [indexStatus, setIndexStatus] = useState<RagWorkerIndexStatus>();
  const [indexAction, setIndexAction] = useState<'retry' | 'rebuild'>();
  const [leftCollapsed, setLeftCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem(PANE_PREFS_KEY) || '{}').left === true; } catch { return false; } });
  const [rightCollapsed, setRightCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem(PANE_PREFS_KEY) || '{}').right === true; } catch { return false; } });
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => documents.find((item) => item.id === selectedId) ?? documents[0], [documents, selectedId]);

  const documentsRef = useRef<ParsedDocument[]>([]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => () => { documentsRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)); }, []);
  useEffect(() => { localStorage.setItem(PANE_PREFS_KEY, JSON.stringify({ left: leftCollapsed, right: rightCollapsed })); }, [leftCollapsed, rightCollapsed]);

  const refreshIndexStatus = useCallback(async () => {
    try { setIndexStatus(await window.electronAPI.ragWorker.indexStatus()); } catch { setIndexStatus(undefined); }
  }, []);
  useEffect(() => {
    void refreshIndexStatus();
    const timer = window.setInterval((): void => { void refreshIndexStatus(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshIndexStatus]);

  useEffect(() => {
    let attempts = 0;
    const restore = () => {
      attempts += 1;
      if (!isDbReady()) return attempts >= 30;
      try {
        const records = dbLoadDocumentKnowledge();
        const restored = records.map((record) => ({ id: record.id, name: record.name, kind: record.kind as ParsedDocument['kind'], size: record.size, sections: record.sections as unknown as ParsedDocument['sections'], plainText: record.plainText, cachedFilePath: record.cachedFilePath ?? undefined, createdAt: record.createdAt }));
        setDocuments(restored);
        void Promise.all(restored.filter((document) => document.kind === 'pdf' && document.cachedFilePath).map(async (document) => {
          const cached = await window.electronAPI.documentCache.load(document.id);
          if (!cached.success || !cached.data) return;
          const previewUrl = URL.createObjectURL(new Blob([cached.data], { type: 'application/pdf' }));
          setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, previewUrl } : item));
        }));
        const restoredChunks = records.flatMap((record) => record.chunks as unknown as DocumentChunk[]);
        setChunks(restoredChunks);
        void (async () => {
          for (const record of records) {
            const document = restored.find((item) => item.id === record.id);
            if (!document) continue;
            await syncRustRagDocument(
              document,
              record.chunks as unknown as DocumentChunk[],
              embeddingIdentity(record.embeddingMode as EmbeddingMode, useStore.getState().memoryConfig),
            );
          }
        })();
        if (records[0]) { setSelectedId(records[0].id); setEmbeddingMode(records[0].embeddingMode as EmbeddingMode); setStage('ready'); setStatus(`已恢复 ${records.length} 个文档`); }
      } catch { /* A new database can legitimately have no persisted documents. */ }
      return true;
    };
    if (restore()) return;
    const timer = window.setInterval(() => { if (restore()) window.clearInterval(timer); }, 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId || !isDbReady()) return;
    try { dbTouchDocumentKnowledge(selectedId); void flushDbToDisk(); } catch { /* Viewing still works if persistence is temporarily unavailable. */ }
  }, [selectedId]);

  const addFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter((file) => isSupportedDocument(file.name));
    if (!accepted.length) { setStage('error'); setStatus('仅支持 PDF、DOCX、XLSX、XLS 和 PPTX'); return; }
    setStage('indexing');
    try {
      let activeMode = embeddingMode;
      for (const file of accepted) {
        const result = await indexDocument(file, memoryConfig, (label, value) => {
          setStatus(`${file.name} · ${label}`); setProgress(value);
        }, activeMode);
        activeMode = result.embeddingMode;
        if (result.document.kind === 'pdf') {
          const cached = await window.electronAPI.documentCache.save(result.document.id, await file.arrayBuffer());
          if (!cached.success || !cached.filePath) throw new Error(cached.error ?? 'PDF 本地保存失败');
          result.document.cachedFilePath = cached.filePath;
        }
        setEmbeddingMode(result.embeddingMode);
        setDocuments((current) => [...current.filter((item) => item.id !== result.document.id), result.document]);
        setChunks((current) => [...current.filter((item) => item.documentId !== result.document.id), ...result.chunks]);
        setSelectedId(result.document.id);
        if (isDbReady()) {
          dbSaveDocumentKnowledge({ id: result.document.id, name: result.document.name, kind: result.document.kind, size: result.document.size, sections: result.document.sections, plainText: result.document.plainText, chunks: result.chunks, embeddingMode: result.embeddingMode, cachedFilePath: result.document.cachedFilePath, createdAt: result.document.createdAt, lastViewedAt: Date.now() });
          await flushDbToDisk();
        }
        await syncRustRagDocument(result.document, result.chunks, embeddingIdentity(result.embeddingMode, memoryConfig));
        void refreshIndexStatus();
      }
      setStage('ready'); setStatus(`已建立索引：${accepted.length} 个文件`); setProgress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理文档失败';
      setStage('error'); setStatus(message);
      toast.error(`文档处理失败：${message}`, { duration: 7000 });
    }
  }, [embeddingMode, memoryConfig, refreshIndexStatus]);

  const retryFailedIndex = useCallback(async () => {
    setIndexAction('retry');
    try {
      const result = await window.electronAPI.ragWorker.retryFailed();
      toast.success(`已重新排队 ${result.requeued} 个索引操作`);
      await refreshIndexStatus();
    } catch (error) {
      toast.error(`索引重试失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setIndexAction(undefined); }
  }, [refreshIndexStatus]);

  const rebuildAllIndexes = useCallback(async () => {
    if (!embeddingMode || !documents.length) return;
    setIndexAction('rebuild');
    setStage('indexing'); setStatus('正在重建本地检索索引');
    let completed = 0;
    try {
      let activeMode: EmbeddingMode | undefined;
      const rebuiltChunks: DocumentChunk[] = [];
      for (const document of documents) {
        const documentChunks = chunks.filter((chunk) => chunk.documentId === document.id);
        const rebuilt = await reembedDocumentChunks(documentChunks, memoryConfig, activeMode, (done, total) => {
          setStatus(`${document.name} · 向量化 ${done}/${total}`);
        });
        activeMode = rebuilt.embeddingMode;
        rebuiltChunks.push(...rebuilt.chunks);
        if (isDbReady()) {
          dbSaveDocumentKnowledge({ id: document.id, name: document.name, kind: document.kind, size: document.size,
            sections: document.sections, plainText: document.plainText, chunks: rebuilt.chunks,
            embeddingMode: rebuilt.embeddingMode, cachedFilePath: document.cachedFilePath,
            createdAt: document.createdAt, lastViewedAt: Date.now() });
        }
        if (await syncRustRagDocument(document, rebuilt.chunks, embeddingIdentity(rebuilt.embeddingMode, memoryConfig), true)) completed += 1;
      }
      setChunks(rebuiltChunks);
      if (activeMode) setEmbeddingMode(activeMode);
      if (isDbReady()) await flushDbToDisk();
      setStage('ready'); setStatus(`已提交 ${completed} 个文档重建`);
      await refreshIndexStatus();
    } catch (error) {
      setStage('error'); setStatus(error instanceof Error ? error.message : String(error));
    } finally { setIndexAction(undefined); }
  }, [chunks, documents, embeddingMode, memoryConfig, refreshIndexStatus]);

  const ask = useCallback(async () => {
    const content = question.trim();
    if (!content || !chunks.length || stage === 'asking') return;
    if (!aiApi.apiKey) { setStage('error'); setStatus('请先在设置中配置 AI API Key'); return; }
    setQuestion(''); setStage('asking');
    const userMessage: RagMessage = { id: `u-${Date.now()}`, role: 'user', content };
    const assistantId = `a-${Date.now()}`;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    try {
      if (!embeddingMode) throw new Error('文档索引模式不可用，请重新上传文档');
      const vector = await embedQuestion(content, memoryConfig, embeddingMode);
      const hits = await hybridRetrieve(chunks, content, vector, embeddingIdentity(embeddingMode, memoryConfig), {
        limit: memoryConfig.recallCount || 5,
        minScore: memoryConfig.minScore,
        maxPerDocument: memoryConfig.maxPerDocument,
        contextBudget: memoryConfig.contextBudget,
      });
      const provider = createOpenAIProvider(aiApi);
      const prompt = `仅根据以下资料回答问题。资料不足时明确说明，不要编造。引用结论时使用 [资料 N] 标记。\n\n${buildRagContext(hits)}\n\n问题：${content}`;
      let answer = '';
      for await (const part of provider.chat([
        { role: 'system', content: '你是严谨的文档问答助手。回答简洁、准确，并给出资料出处。' },
        { role: 'user', content: prompt },
      ], { model: aiApi.model, temperature: 0.2 })) {
        answer += part.delta;
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: answer, sources: hits } : message));
      }
      setStage('ready'); setStatus(`已从 ${hits.length} 个片段生成回答`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '问答失败';
      setStage('error'); setStatus(message);
      toast.error(`文档问答失败：${message}`, { duration: 7000 });
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: '生成回答失败，请检查模型与向量配置。' } : message));
    }
  }, [aiApi, chunks, embeddingMode, memoryConfig, question, stage]);

  const removeDocument = useCallback((id: string) => {
    const target = documents.find((item) => item.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setDocuments((current) => current.filter((item) => item.id !== id));
    setChunks((current) => current.filter((item) => item.documentId !== id));
    if (documents.length === 1) setEmbeddingMode(undefined);
    setSelectedId(undefined);
    if (isDbReady()) { try { dbDeleteDocumentKnowledge(id); void flushDbToDisk(); } catch { /* Keep UI removal responsive. */ } }
    void window.electronAPI.documentCache.delete(id);
    void window.electronAPI.ragWorker.deleteDocument(id).catch(() => undefined);
  }, [documents]);

  return <div className="flex h-full min-h-0 bg-background text-foreground">
    <aside className={`${leftCollapsed ? 'w-10' : 'w-64'} shrink-0 border-r flex flex-col transition-[width] duration-200`}>
      {leftCollapsed ? <div className="flex justify-center border-b p-1.5"><button title="展开文档列表" onClick={() => setLeftCollapsed(false)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><PanelLeft className="h-4 w-4" /></button></div> : <>
      <div className="p-3 border-b">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">文档列表</span><button title="折叠文档列表" onClick={() => setLeftCollapsed(true)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PanelLeft className="h-4 w-4" /></button></div>
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.pptx" className="hidden"
          onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <button className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm flex items-center justify-center gap-2"
          onClick={() => inputRef.current?.click()} disabled={stage === 'indexing'}>
          {stage === 'indexing' ? <Loader2 className="h-4 w-4" /> : <Upload className="h-4 w-4" />} 上传并解析
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">PDF · Word · Excel · PowerPoint</p>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {documents.map((document) => <button key={document.id} onClick={() => setSelectedId(document.id)}
          className={`w-full text-left rounded-md p-2 group ${selected?.id === document.id ? 'bg-accent' : 'hover:bg-muted'}`}>
          <div className="flex gap-2 items-start"><FileText className="h-4 w-4 mt-0.5 shrink-0" /><div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{document.name}</div>
            <div className="text-[10px] text-muted-foreground">{document.sections.length} 个结构 · {chunks.filter((item) => item.documentId === document.id).length} 个片段</div>
          </div><span role="button" tabIndex={0} title="移除" className="opacity-0 group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); removeDocument(document.id); }}><Trash2 className="h-3.5 w-3.5" /></span></div>
        </button>)}
        {!documents.length && <div className="p-4 text-center text-xs text-muted-foreground">尚未添加文档</div>}
      </div>
      <div className="border-t p-3 text-[11px] text-muted-foreground"><div className="flex items-center gap-1"><Database className="h-3.5 w-3.5" />{status}</div>
        {embeddingMode && <div className="mt-1">索引模式：{embeddingMode === 'remote-semantic' ? '远程语义' : embeddingMode === 'local-semantic' ? '本地语义' : '关键词降级'}</div>}
        {indexStatus && <div className="mt-2 rounded border bg-muted/30 p-2 space-y-1">
          <div>{indexStatus.documents} 文档 · {indexStatus.chunks} 片段</div>
          <div className={indexStatus.failedOutbox ? 'text-destructive' : ''}>待同步 {indexStatus.pendingOutbox} · 失败 {indexStatus.failedOutbox}</div>
          <div className="flex gap-1 pt-1">
            {indexStatus.failedOutbox > 0 && <button type="button" className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={!!indexAction} onClick={() => void retryFailedIndex()}><RefreshCw className={`mr-1 inline h-3 w-3 ${indexAction === 'retry' ? 'animate-spin' : ''}`} />重试</button>}
            <button type="button" className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={!!indexAction || !documents.length} onClick={() => void rebuildAllIndexes()}><RefreshCw className={`mr-1 inline h-3 w-3 ${indexAction === 'rebuild' ? 'animate-spin' : ''}`} />重建</button>
          </div>
        </div>}
        {stage === 'indexing' && <div className="mt-2 h-1 bg-muted rounded"><div className="h-full bg-primary rounded" style={{ width: `${progress}%` }} /></div>}
      </div>
      </>}
    </aside>

    <main className="flex-1 min-w-0 flex flex-col border-r">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium"><span className="min-w-0 flex-1 truncate">文档预览{selected ? ` · ${selected.name}` : ''}</span>{rightCollapsed && <button title="展开 RAG 问答" onClick={() => setRightCollapsed(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PanelRight className="h-4 w-4" /></button>}</div>
      <div className="flex-1 min-h-0 overflow-auto bg-muted/30">
        {!selected ? <div className="h-full flex items-center justify-center text-sm text-muted-foreground">上传文件后在这里预览解析结果</div>
          : selected.kind === 'pdf' && selected.previewUrl ? <iframe className="w-full h-full border-0" src={selected.previewUrl} title={selected.name} />
            : <article className="mx-auto max-w-4xl p-8">{selected.kind === 'pdf' && <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">应用重启后无法继续使用临时 PDF 地址，当前显示已保存的分页文本。重新上传同一文件可恢复原始 PDF 预览，不会重复建立索引。</div>}{selected.sections.map((item) => <section key={item.id} className="mb-10 rounded-lg border bg-background px-8 py-7 shadow-sm"><h2 className="mb-5 border-b pb-3 text-lg font-semibold">{item.title}</h2><div className="space-y-3 text-sm leading-7 text-foreground">{previewParagraphs(item.content).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words">{paragraph}</p>)}</div></section>)}</article>}
      </div>
    </main>

    {!rightCollapsed && <section className="w-[38%] min-w-[320px] flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium"><span className="flex-1">RAG 文档问答</span><button title="折叠 RAG 问答" onClick={() => setRightCollapsed(true)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PanelRight className="h-4 w-4" /></button></div>
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {!messages.length && <div className="text-xs text-muted-foreground leading-6">完成解析和向量化后，可针对全部已上传文档提问。回答会附带命中的文件、章节和页码。</div>}
        {messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-8 rounded-lg bg-primary text-primary-foreground p-3 text-sm' : 'mr-4 rounded-lg bg-muted p-3 text-sm'}>
          {message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '正在生成…'}</ReactMarkdown> : message.content}
          {!!message.sources?.length && <details className="mt-3 text-[11px] text-muted-foreground"><summary className="cursor-pointer">查看 {message.sources.length} 条引用</summary>{message.sources.map((source, index) => <div key={source.id} className="mt-2 border-t pt-2"><b>[资料 {index + 1}] {source.documentName}</b> · {source.sectionTitle}{source.page ? ` · 第 ${source.page} 页` : ''}{source.mergedChunkIds && <span> · 合并 {source.mergedChunkIds.length} 段</span>}<div className="mt-0.5 text-[10px]">综合 {source.retrievalScores?.fused?.toFixed(4) ?? source.score.toFixed(4)}{source.retrievalScores?.vector !== undefined ? ` · 向量 ${source.retrievalScores.vector.toFixed(3)}` : ''}{source.retrievalScores?.lexical !== undefined ? ` · 关键词 ${source.retrievalScores.lexical.toFixed(3)}` : ''}</div><div className="line-clamp-3">{source.content}</div></div>)}</details>}
        </div>)}
      </div>
      <div className="border-t p-3 flex gap-2"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={chunks.length ? '询问这些文档…' : '请先上传并索引文档'} disabled={!chunks.length}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} className="flex-1 min-h-10 max-h-28 resize-y rounded-md border bg-background px-3 py-2 text-sm" />
        <button onClick={() => void ask()} disabled={!question.trim() || !chunks.length || stage === 'asking'} className="self-end rounded-md bg-primary text-primary-foreground p-2.5 disabled:opacity-40"><Send className="h-4 w-4" /></button></div>
    </section>}
  </div>;
};
