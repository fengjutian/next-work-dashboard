/**
 * Work Browser — IPC 入口
 *
 * Channel 命名：work-browser:<domain>:<action>
 *
 * 规则：所有 channel 必须在 preload/work-browser.ts 中 ipcRenderer.invoke 对应。
 * scripts/check-ipc-contract.mjs 会自动校验。
 */
import { ipcMain, dialog } from 'electron';
import { getDatabase } from './database';
import { WorkspaceStore } from './workspace-store';
import { DocumentStore } from './document-store';
import { SearchRouter } from './search-router';
import { savePageAsMarkdown } from './save';
import { importParsedDocument } from './import-document';
import { getCleanerPayload, getWebviewCleanerPreloadPath, setupWorkBrowserSession } from './cleaner';
import { getMainWindow } from '../globals';
import { suggestWorkspacesForDocument } from '../../core/work-browser/workspace/auto-group';
import { instantiateTask, ALL_TEMPLATES, type TaskTemplate } from '../../core/work-browser/task/template';
import { runTask, type TaskStepHandler } from '../../core/work-browser/task/runner';
import { buildAutoHandlers, type TaskAutoContext } from '../../core/work-browser/task/auto-handlers';
import { buildRagContext } from '../../core/work-browser/ai/rag';
import { extractReadability } from '../../core/work-browser/parser';
import { embed } from '../../core/work-browser/embedding/embedder';
import { searchLanceDocuments } from '../lancedb-memory';
import { DEFAULT_MODEL_ID } from '../../core/work-browser/embedding/embedder';
import { summarizeResults } from '../../core/work-browser/ai/summarizer';
import { resolveWorkBrowserAIConfig, setRuntimeAIConfig } from './ai-config';
import { buildMcpAgentTools, recordMcpAgentDenial } from './mcp-tools';
import { GraphStore } from '../../core/work-browser/graph/edges';
import { ResearchEvidenceStore, type EvidenceStatus } from './research-evidence-store';
import { WorkBrowserSyncService, type SyncTargetInput } from './sync-service';
import { SyncTargetStore } from './sync-target-store';
import type {
  WorkspaceId, TabId, DocumentId, ConversationId, TaskId, TaskStatus, Task, AnnotationId,
} from '../../core/work-browser/types';

let initialized = false;

export function setupWorkBrowserIPC(): void {
  if (initialized) return;
  initialized = true;

  // 注册 work-browser 专属 session 的网络层净化
  setupWorkBrowserSession();

  const db = getDatabase();
  const workspaces = new WorkspaceStore(db);
  const documents = new DocumentStore(db);
  const resolveAIConfig = () => resolveWorkBrowserAIConfig((key) => workspaces.getSetting(key));
  const search = new SearchRouter(workspaces, db, resolveAIConfig);
  const graph = new GraphStore(db);
  const evidenceStore = new ResearchEvidenceStore(db);
  const syncService = new WorkBrowserSyncService(workspaces);
  const syncTargets = new SyncTargetStore();
  const searchRequests = new Map<string, AbortController>();

  // ── Workspace ──

  ipcMain.handle('work-browser:workspace:list', (_e, includeArchived?: boolean) => workspaces.listWorkspaces(!!includeArchived));
  ipcMain.handle('work-browser:workspace:create', (_e, input: Parameters<WorkspaceStore['createWorkspace']>[0]) => workspaces.createWorkspace(input));
  ipcMain.handle('work-browser:workspace:update', (_e, id: WorkspaceId, patch: any) => { workspaces.updateWorkspace(id, patch); return workspaces.getWorkspace(id); });
  ipcMain.handle('work-browser:workspace:archive', (_e, id: WorkspaceId) => { workspaces.archiveWorkspace(id); });
  ipcMain.handle('work-browser:workspace:get', (_e, id: WorkspaceId) => workspaces.getWorkspace(id));

  // ── Tab ──

  ipcMain.handle('work-browser:tab:list', (_e, workspaceId: WorkspaceId) => workspaces.listTabs(workspaceId));
  ipcMain.handle('work-browser:tab:create', (_e, input: { workspaceId: WorkspaceId; url: string; title?: string; position?: number }) => workspaces.createTab(input));
  ipcMain.handle('work-browser:tab:update', (_e, id: TabId, patch: any) => { workspaces.updateTab(id, patch); });
  ipcMain.handle('work-browser:tab:delete', (_e, id: TabId) => workspaces.deleteTab(id));

  // ── Document ──

  ipcMain.handle('work-browser:document:list', (_e, workspaceId: WorkspaceId, limit?: number) => documents.listDocuments(workspaceId, limit));
  ipcMain.handle('work-browser:document:get', (_e, id: DocumentId) => documents.getDocument(id));
  ipcMain.handle('work-browser:document:versions', (_e, id: DocumentId) => documents.listVersions(id));
  ipcMain.handle('work-browser:document:compare', async (_e, id: DocumentId) => {
    const document = documents.getDocument(id);
    if (!document) throw new Error(`Document not found: ${id}`);
    const versions = documents.listVersions(id, 2);
    if (versions.length < 2) throw new Error('至少需要两个已保存版本才能比较');
    const fs = await import('node:fs/promises');
    const readVersion = async (version: typeof versions[number]) => {
      const html = await fs.readFile(version.rawPath, 'utf8');
      const parsed = await extractReadability(html);
      return {
        label: `${document.title} · ${new Date(version.capturedAt).toLocaleString('zh-CN')}.md`,
        content: `# ${parsed.title || document.title}\n\n${parsed.contentMarkdown}`,
      };
    };
    const [newer, older] = await Promise.all([readVersion(versions[0]), readVersion(versions[1])]);
    return { left: older, right: newer };
  });
  ipcMain.handle('work-browser:document:save', async (_e, input: Parameters<typeof savePageAsMarkdown>[0]) => {
    return await savePageAsMarkdown(input, workspaces, documents);
  });
  ipcMain.handle('work-browser:document:import', async (_e, input: Parameters<typeof importParsedDocument>[0]) => {
    return await importParsedDocument(input, workspaces, documents);
  });

  // ── Note ──

  ipcMain.handle('work-browser:note:list', (_e, workspaceId: WorkspaceId) => workspaces.listNotes(workspaceId));
  ipcMain.handle('work-browser:note:create', (_e, input: Parameters<WorkspaceStore['createNote']>[0]) => workspaces.createNote(input));

  // ── Task ──

  ipcMain.handle('work-browser:task:list', (_e, workspaceId: WorkspaceId, status?: TaskStatus) => workspaces.listTasks(workspaceId, status));
  ipcMain.handle('work-browser:task:upsert', (_e, task: Task) => { workspaces.upsertTask(task); });
  ipcMain.handle('work-browser:task:templates', () => ALL_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, stepCount: t.steps.length })));
  ipcMain.handle('work-browser:task:create-from-template', (_e, input: { workspaceId: WorkspaceId; templateId: string; title?: string }): Task => {
    const tpl = ALL_TEMPLATES.find((t) => t.id === input.templateId);
    if (!tpl) throw new Error(`Unknown task template: ${input.templateId}`);
    const task = instantiateTask(input.workspaceId, tpl as TaskTemplate, input.title);
    workspaces.upsertTask(task);
    return task;
  });

  // AI Agent — 单轮 tool calling
  ipcMain.handle('work-browser:agent:run', async (_e, input: { userMessage: string; workspaceId?: string; systemPrompt?: string; maxSteps?: number; autoApproveDanger?: boolean; contextSources?: AgentContextSources }) => {
    const { runAgent, BUILTIN_TOOLS } = await import('../../core/work-browser/agent/runner');
    const cfg = await resolveAIConfig();
    if (!cfg.apiKey && !cfg.local) {
      throw new Error('AI 未配置 baseUrl / apiKey');
    }
    // 把 contextSources 拼到 system prompt 头部（runner 不感知）
    const ctxBlock = buildAgentContextBlock(workspaces, input.workspaceId as WorkspaceId | undefined, input.contextSources);
    const finalSystem = ctxBlock ? `${ctxBlock}\n\n${input.systemPrompt || ''}`.trim() : input.systemPrompt;
    const steps: any[] = [];
    const mcpTools = buildMcpAgentTools();
    const result = await runAgent({
      userMessage: input.userMessage,
      systemPrompt: finalSystem,
      config: {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxSteps: input.maxSteps ?? 5,
        timeoutMs: 90000,
      },
      toolContext: {
        workspaceId: (input.workspaceId as any) || null,
        search: {
          async run(inp) {
            const r = await search.runSearch({ text: inp.query, workspaceId: inp.workspaceId, scope: inp.scope });
            return {
              results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
              summary: r.aiSummary,
            };
          },
        },
        rag: {
          async run(inp) {
            const bundle = await search.runRag({ query: inp.query, workspaceId: inp.workspaceId, topK: inp.topK });
            return {
              systemPrompt: bundle.systemPrompt,
              citations: bundle.citations,
              chunks: bundle.chunks,
            };
          },
        },
        document: {
          async save(params) {
            const r = await savePageAsMarkdown(params, workspaces, documents);
            return { documentId: r.documentId, wordCount: r.wordCount };
          },
        },
        tab: {
          async create(params) { return await workspaces.createTab(params); },
        },
        annotation: {
          async create(params) { return await documents.createAnnotation(params); },
        },
        confirmDanger: async ({ toolName, args, reason }) => {
          if (input.autoApproveDanger) return true;
          // 弹原生 dialog 真实确认（用户必须选才能继续）
          const win = getMainWindow();
          const argPreview = JSON.stringify(args, null, 2).slice(0, 600);
          const result = await dialog.showMessageBox(win ?? undefined as any, {
            type: 'warning',
            title: 'AI Agent 危险动作确认',
            message: `工具：${toolName}`,
            detail: `原因：${reason}\n\n参数：\n${argPreview}`,
            buttons: ['允许', '拒绝'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          });
          const allowed = result.response === 0;
          if (!allowed) recordMcpAgentDenial(toolName, args as Record<string, unknown>);
          console.log(`[work-browser:agent] dangerous tool "${toolName}" ${allowed ? 'allowed' : 'denied'} by user`);
          return allowed;
        },
      },
      extraTools: mcpTools,
      onStep: (s) => { steps.push(s); },
    });
    return { ...result, steps, availableTools: [...BUILTIN_TOOLS, ...mcpTools].map((t) => t.name) };
  });

  // Research Mode 一站式：构造 task + run auto + 保存报告
  ipcMain.handle('work-browser:research:run', async (_e, input: { topic: string; workspaceId: WorkspaceId; autoSave?: boolean }) => {
    // 复用 task:run-auto 的 ctx 构造（不重写）
    const buildCtx = () => {
      const ctx: TaskAutoContext = {
        workspaceId: input.workspaceId,
        search: {
          async run(inp) {
            const r = await search.runSearch({ text: inp.query, workspaceId: inp.workspaceId, scope: inp.scope });
            return {
              results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
              summary: r.aiSummary,
            };
          },
        },
        rag: {
          async run(inp) {
            const bundle = await search.runRag({ query: inp.query, workspaceId: inp.workspaceId, topK: inp.topK, scope: inp.scope });
            return {
              systemPrompt: bundle.systemPrompt,
              citations: bundle.citations,
              chunks: bundle.chunks.map((c) => ({
                documentId: c.documentId, content: c.content, sectionTitle: c.sectionTitle, page: c.page, fusedScore: c.fusedScore,
              })),
            };
          },
        },
        summarize: undefined,
      };
      return ctx;
    };
    const { runResearch } = await import('../../core/work-browser/research/mode');
    const ctx = buildCtx();
    const result = await runResearch(
      { topic: input.topic, workspaceId: input.workspaceId, autoSave: input.autoSave ?? true },
      ctx,
      {
        saveDocument: async (params: { workspaceId: WorkspaceId; title: string; url: string; markdown: string }) => {
          try {
            const ws = workspaces.getWorkspace(params.workspaceId);
            if (!ws) return undefined;
            const { computeContentHash, newDocument, newDocumentVersion } = await import('../../core/work-browser/document/version');
            const t = Date.now();
            const id = newDocument({
              workspaceId: params.workspaceId,
              title: params.title,
              url: params.url,
              sourceType: 'note',
              contentPath: '',
              rawPath: '',
              contentHash: computeContentHash(params.markdown),
              wordCount: params.markdown.split(/\s+/).filter(Boolean).length,
              summary: params.markdown.slice(0, 240),
            });
            const contentPath = `${ws.storagePath || `app://userData/work-browser-documents/${params.workspaceId}`}/documents/${id.id}.md`;
            const rawPath = `${ws.storagePath || `app://userData/work-browser-documents/${params.workspaceId}`}/raw/${id.id}-${t}.md`;
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            await fs.mkdir(path.dirname(contentPath), { recursive: true });
            await fs.writeFile(contentPath, params.markdown, 'utf8');
            await fs.mkdir(path.dirname(rawPath), { recursive: true });
            await fs.writeFile(rawPath, params.markdown, 'utf8');
            documents.upsertDocument({ ...id, contentPath, rawPath, plainText: params.markdown, updatedAt: t } as any);
            documents.appendVersion(newDocumentVersion({ documentId: id.id, contentHash: id.contentHash, rawPath, prevWordCount: 0, wordCount: id.wordCount }));
            return contentPath;
          } catch (e) {
            console.error('[work-browser] research save failed:', e);
            return undefined;
          }
        },
      },
    );
    const evidence = evidenceStore.record(result.task.id, input.workspaceId, result.citations);
    return {
      taskId: result.task.id,
      report: result.report,
      citations: evidence,
      reportPath: result.reportPath,
      took: result.took,
    };
  });
  ipcMain.handle('work-browser:research:evidence-list', (_event, researchId: string) => evidenceStore.list(researchId));
  ipcMain.handle('work-browser:research:evidence-status', (_event, id: string, status: EvidenceStatus) => evidenceStore.setStatus(id, status));
  ipcMain.handle('work-browser:sync:preview', (_event, workspaceId: string, target: SyncTargetInput) => syncService.preview(workspaceId, target));
  ipcMain.handle('work-browser:sync:push', (_event, workspaceId: string, target: SyncTargetInput, overwrite?: boolean) => syncService.push(workspaceId, target, !!overwrite));
  ipcMain.handle('work-browser:sync:pull', (_event, workspaceId: string, target: SyncTargetInput, overwrite?: boolean) => syncService.pull(workspaceId, target, !!overwrite));
  ipcMain.handle('work-browser:sync:target-list', () => syncTargets.list());
  ipcMain.handle('work-browser:sync:target-get', (_event, id: string) => syncTargets.get(id));
  ipcMain.handle('work-browser:sync:target-save', (_event, target: SyncTargetInput) => syncTargets.save(target));
  ipcMain.handle('work-browser:sync:target-delete', (_event, id: string) => syncTargets.remove(id));

  // Task 自动编排：跑一个 task 的所有 step，用 auto-handler 链
  ipcMain.handle('work-browser:task:run-auto', async (_e, taskId: TaskId) => {
    // 从 SQLite 找 task — 用临时遍历所有 workspace
    let task: Task | null = null;
    for (const ws of workspaces.listWorkspaces(false)) {
      const list = workspaces.listTasks(ws.id);
      const found = list.find((t) => t.id === taskId);
      if (found) { task = found; break; }
    }
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const ctx: TaskAutoContext = {
      workspaceId: task.workspaceId,
      search: {
        async run(input) {
          const r = await search.runSearch({
            text: input.query,
            workspaceId: input.workspaceId,
            scope: input.scope,
          });
          return {
            results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
            summary: r.aiSummary,
          };
        },
      },
      rag: {
        async run(input) {
          const bundle = await search.runRag({
            query: input.query,
            workspaceId: input.workspaceId,
            topK: input.topK,
            scope: input.scope,
          });
          return {
            systemPrompt: bundle.systemPrompt,
            citations: bundle.citations,
            chunks: bundle.chunks.map((c) => ({
              documentId: c.documentId,
              content: c.content,
              sectionTitle: c.sectionTitle,
              page: c.page,
              fusedScore: c.fusedScore,
            })),
          };
        },
      },
      summarize: async ({ systemPrompt, userPrompt }) => {
        const cfg = await resolveAIConfig();
        if (!cfg.apiKey && !cfg.local) return null;
        const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            temperature: 0.2,
            max_tokens: 1500,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content?.trim() || null;
      },
    };

    const handle = runTask(task, {
      handlers: buildAutoHandlers() as unknown as Record<string, TaskStepHandler>,
      onEvent: (e) => {
        // 每个 step 事件后同步当前 task 到 SQLite
        try { workspaces.upsertTask(handle.getCurrent()); } catch { /* 静默 */ }
      },
    });
    const final = await handle.promise;
    workspaces.upsertTask(final);
    return final;
  });

  // ── AI Conversation ──

  ipcMain.handle('work-browser:conversation:list', (_e, workspaceId: WorkspaceId) => workspaces.listConversations(workspaceId));
  ipcMain.handle('work-browser:conversation:get', (_e, id: ConversationId) => workspaces.getConversation(id));
  ipcMain.handle('work-browser:conversation:upsert', (_e, conv: any) => { workspaces.upsertConversation(conv); });

  // ── Search ──

  ipcMain.handle('work-browser:search:providers', () => search.listProviders());
  ipcMain.handle('work-browser:search:run', async (_e, input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }) => {
    return await search.runSearch(input);
  });
  ipcMain.handle('work-browser:search:start', async (event, requestId: string, input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }) => {
    searchRequests.get(requestId)?.abort();
    const controller = new AbortController();
    searchRequests.set(requestId, controller);
    try {
      return await search.runSearch(input, {
        signal: controller.signal,
        onProgress: (progress) => event.sender.send('work-browser:search:progress', { requestId, ...progress }),
      });
    } finally {
      if (searchRequests.get(requestId) === controller) searchRequests.delete(requestId);
    }
  });
  ipcMain.handle('work-browser:search:cancel', (_event, requestId: string) => {
    searchRequests.get(requestId)?.abort();
    searchRequests.delete(requestId);
  });
  ipcMain.handle('work-browser:search:suggest', async (_e, text: string) => await search.getSuggestions(text));
  ipcMain.handle('work-browser:search:history', (_e, limit?: number) => workspaces.listSearchHistory(limit));

  // ── Cleaner ──

  ipcMain.handle('work-browser:cleaner:payload', (_e, options?: any) => getCleanerPayload(options));
  ipcMain.handle('work-browser:cleaner:webview-payload', () => getCleanerPayload());
  ipcMain.handle('work-browser:cleaner:webview-preload-path', () => getWebviewCleanerPreloadPath());

  // ── Research Graph ──

  ipcMain.handle('work-browser:graph:list-by-document', (_e, documentId: DocumentId, kinds?: string[]) => {
    return graph.listByDocument(documentId, kinds as any);
  });
  ipcMain.handle('work-browser:graph:list-by-workspace', (_e, workspaceId: WorkspaceId, kind?: string) => {
    return graph.listByWorkspace(workspaceId, kind as any);
  });
  // 自动记录 save 边：saved-with
  ipcMain.handle('work-browser:graph:record-saved-with', (_e, workspaceId: WorkspaceId, documentIds: DocumentId[]) => {
    // 同一 workspace 内两两产生 saved-with 边
    for (let i = 0; i < documentIds.length; i++) {
      for (let j = i + 1; j < documentIds.length; j++) {
        graph.recordEdge({
          kind: 'saved-with',
          workspaceId,
          fromType: 'document',
          fromId: documentIds[i],
          toType: 'document',
          toId: documentIds[j],
          weight: 1,
          metadata: '{}',
        });
      }
    }
    return documentIds.length;
  });
  ipcMain.handle('work-browser:graph:record-edge', (_e, input: {
    kind: string; workspaceId: WorkspaceId;
    fromType: string; fromId: string; toType: string; toId: string;
    weight?: number; metadata?: Record<string, unknown>;
  }) => {
    const kinds = new Set(['cited-by', 'similar-to', 'searched-from', 'opened-from', 'saved-with']);
    const nodeTypes = new Set(['document', 'tab', 'annotation']);
    if (!kinds.has(input.kind) || !nodeTypes.has(input.fromType) || !nodeTypes.has(input.toType)) throw new Error('INVALID_GRAPH_EDGE');
    if (!input.workspaceId || !input.fromId || !input.toId || input.fromId.length > 1024 || input.toId.length > 1024) throw new Error('INVALID_GRAPH_NODE');
    const weight = typeof input.weight === 'number' && Number.isFinite(input.weight)
      ? Math.max(0.01, Math.min(100, input.weight))
      : 1;
    const metadata = JSON.stringify(input.metadata ?? {});
    if (metadata.length > 16_384) throw new Error('GRAPH_METADATA_TOO_LARGE');
    graph.recordEdge({
      kind: input.kind as any,
      workspaceId: input.workspaceId,
      fromType: input.fromType as any,
      fromId: input.fromId,
      toType: input.toType as any,
      toId: input.toId,
      weight,
      metadata,
    });
  });

  // ── Annotation ──

  ipcMain.handle('work-browser:annotation:list', (_e, documentId: DocumentId) => documents.listAnnotations(documentId));
  // 按 url 查 annotation（高亮回放用）
  ipcMain.handle('work-browser:annotation:list-by-url', (_e, url: string) => {
    // 先按 url 找 document
    const doc = db.prepare('SELECT id FROM documents WHERE url = ? ORDER BY updated_at DESC LIMIT 1').get(url) as { id: string } | undefined;
    if (!doc) return [];
    return documents.listAnnotations(doc.id as DocumentId);
  });
  // 一次拿 workspace 内所有 annotations（Graph 用）
  ipcMain.handle('work-browser:annotation:list-by-workspace', (_e, workspaceId: WorkspaceId) => {
    return db.prepare(`
      SELECT a.* FROM annotations a
      JOIN documents d ON a.document_id = d.id
      WHERE d.workspace_id = ?
      ORDER BY a.created_at ASC
    `).all(workspaceId).map((r: any) => ({
      id: r.id,
      documentId: r.document_id,
      selector: r.selector,
      rangeText: r.range_text,
      note: r.note,
      color: r.color,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
  ipcMain.handle('work-browser:annotation:create', (_e, input: { documentId: DocumentId; selector: string; rangeText: string; note: string; color: 'yellow' | 'green' | 'red' | 'blue' }) => documents.createAnnotation(input));
  ipcMain.handle('work-browser:annotation:delete', (_e, id: AnnotationId) => documents.deleteAnnotation(id));

  // ── RAG ──

  ipcMain.handle('work-browser:rag:query', async (_e, input: { query: string; workspaceId?: string; topK?: number; scope?: 'workspace' | 'library' }) => {
    const modelId = (await workspaces.getSetting('workBrowser.ai.embeddingModel')) || DEFAULT_MODEL_ID;
    const bundle = await buildRagContext({
      query: input.query,
      db,
      vectorSearch: (vec, mid, limit) => searchLanceDocuments(vec, mid, limit).then((rows) => rows.map((r) => ({
        id: r.id,
        distance: r.distance,
        documentId: r.documentId,
        content: r.content,
        sectionTitle: r.sectionTitle,
        page: r.page,
      }))),
      embedder: (text) => embed(text, modelId),
      workspaceId: input.workspaceId,
      modelId,
      topK: input.topK,
      scope: input.scope,
    });
    return {
      systemPrompt: bundle.systemPrompt,
      citations: bundle.citations,
      chunks: bundle.chunks,
      context: bundle.context,
    };
  });

  // ── Settings ──

  ipcMain.handle('work-browser:settings:get', (_e, key: string) => workspaces.getSetting(key));
  ipcMain.handle('work-browser:settings:set', (_e, key: string, value: string) => { workspaces.setSetting(key, value); });
  ipcMain.handle('work-browser:config:set-ai', (_e, input: { baseUrl: string; apiKey: string; model: string; local?: boolean }) => {
    setRuntimeAIConfig(input);
  });

  // ── Auto-group ──

  ipcMain.handle('work-browser:auto-group:suggest', (_e, docSummary: { title: string; url: string; capturedAt: number }) => {
    const all = workspaces.listWorkspaces(false);
    return all
      .map((ws) => ({ workspace: ws, tabs: workspaces.listTabs(ws.id) }))
      .flatMap((entry) => suggestWorkspacesForDocument(docSummary, [entry]).map((c) => ({ workspaceId: c.workspaceId, score: c.score, reasons: c.reasons })));
  });
}

// ── Agent Context Sources（拼接成 system prompt 块） ──

export interface AgentContextSources {
  /** 把当前 workspace 的元信息注入（name / id） */
  workspace?: boolean;
  /** 用户当前正在看的页面（Tab）— 让 Agent 知道"用户在想哪个页面" */
  currentPage?: { url: string; title: string };
  /** 用户显式选中的若干文档（一般是 Library 复选）— 让 Agent 优先参考 */
  specificDocuments?: Array<{ id: string; title: string; url: string }>;
}

function buildAgentContextBlock(
  workspaces: WorkspaceStore,
  workspaceId: WorkspaceId | undefined,
  ctx: AgentContextSources | undefined,
): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.workspace && workspaceId) {
    const ws = workspaces.getWorkspace(workspaceId);
    if (ws) lines.push(`[workspace] 名称: ${ws.name} (${ws.icon || '🗂'})  ID: ${ws.id}`);
  }
  if (ctx.currentPage) {
    lines.push(`[current-page] 标题: ${ctx.currentPage.title}  URL: ${ctx.currentPage.url}`);
  }
  if (ctx.specificDocuments && ctx.specificDocuments.length) {
    lines.push('[specific-documents] 用户选中的文档（请优先参考）：');
    for (const d of ctx.specificDocuments) {
      lines.push(`  - ${d.title} — ${d.url} (id: ${d.id})`);
    }
  }
  if (!lines.length) return '';
  return `<work-browser-context>\n${lines.join('\n')}\n</work-browser-context>`;
}
