import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { fitContextToTokenBudget } from './ai-context';
import { checkTokenBudget } from './ai-token-budget';
import { applyConversationSummary, conversationNeedsSummary, isAbortError, type AiConversationMessage, type AiPendingRequest } from './ai-conversation';
import { languageIdFromName } from '../editor-utils';
import type { OpenDocument } from '../editor-types';
import type { AiFileProposal } from './useAiSessionState';
import type { EditorDiffView } from '../useGitDiffMerge';
import type { AgentTaskConfig, AgentTaskRecord } from '@/types/electron';
import { pathInAgentScope, type AgentEditScope } from './agent-edit-scope';

interface AiApiConfig { apiKey: string; baseUrl: string; model: string }

export type AiExecutionStage = 'idle' | 'collecting-context' | 'summarizing' | 'generating' | 'parsing' | 'review' | 'cancelling' | 'interrupted' | 'failed';
export interface AiExecutionMetrics { startedAt: number; firstChunkAt?: number; endedAt?: number; receivedChars: number }

interface UseAiEditGenerationOptions {
  sessionId?: string;
  scope: AgentEditScope;
  aiApi: AiApiConfig;
  workspace: { path: string } | null;
  isolated?: boolean;
  documents: OpenDocument[];
  activeDocument: OpenDocument | null;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  aiInstruction: string;
  aiMessages: AiConversationMessage[];
  setAiMessages: Dispatch<SetStateAction<AiConversationMessage[]>>;
  aiMode: "analyze" | "modify";
  aiMultiFile: boolean;
  aiTokenBudget: number;
  inlineEdit: { instruction: string; visible: boolean };
  setInlineEdit: Dispatch<SetStateAction<{ instruction: string; visible: boolean }>>;
  setAiEditing: Dispatch<SetStateAction<boolean>>;
  setAiPendingRequest: Dispatch<SetStateAction<AiPendingRequest | null>>;
  setAiProposals: Dispatch<SetStateAction<AiFileProposal[]>>;
  setDiffView: Dispatch<SetStateAction<EditorDiffView | null>>;
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  recordAiSession: (fileCount: number) => void;
  appendOutput: (message: string) => void;
  setStatus: Dispatch<SetStateAction<string>>;
}

async function executeAgentTask(
  config: AgentTaskConfig,
  signal: AbortSignal,
  onProgress: (stage: string, message: string, delta?: string) => void,
): Promise<AgentTaskRecord> {
  let activeTaskId = '';
  let settled = false;
  let lastProgressSeq = 0;
  return new Promise<AgentTaskRecord>((resolve, reject) => {
    const cleanupEvents = window.electronAPI.workspace.onAgentTaskEvent((event) => {
      if (!activeTaskId || event.taskId !== activeTaskId) return;
      if (event.progress && event.progress.seq > lastProgressSeq) {
        lastProgressSeq = event.progress.seq;
        onProgress(event.progress.stage, event.progress.message, event.progress.delta);
      }
      if (!['review', 'failed', 'interrupted'].includes(event.state) || settled) return;
      settled = true;
      cleanupEvents();
      signal.removeEventListener('abort', abort);
      void window.electronAPI.workspace.agentTaskGet(activeTaskId).then((result) => {
        if (event.state === 'review' && result.success && result.data) resolve(result.data);
        else if (event.state === 'interrupted') reject(new DOMException('Agent task cancelled', 'AbortError'));
        else reject(new Error(event.error ?? result.error ?? 'AGENT_TASK_FAILED'));
      });
    });
    const abort = () => {
      if (activeTaskId) void window.electronAPI.workspace.agentTaskCancel(activeTaskId);
    };
    signal.addEventListener('abort', abort, { once: true });
    void window.electronAPI.workspace.agentTaskCreate(config).then((created) => {
      if (!created.success || !created.data) throw new Error(created.error ?? 'AGENT_TASK_CREATE_FAILED');
      activeTaskId = created.data.taskId;
      window.electronAPI.workspace.agentTaskSubscribe(activeTaskId);
      if (signal.aborted) abort();
    }).catch((error) => {
      if (settled) return;
      settled = true;
      cleanupEvents();
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|go|rs|java|vue|svelte)$/i;
const SAFE_PATH = /^[\w./-]+$/;

async function collectContexts(
  workspacePath: string,
  documents: OpenDocument[],
  activeDocument: OpenDocument,
  instruction: string,
  scope: AgentEditScope,
) {
  const listed = await window.electronAPI.workspace.listFiles(workspacePath);
  const terms = instruction.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2);
  const candidates = (listed.data ?? []).filter((file) => pathInAgentScope(file.path, scope) && SOURCE_FILE.test(file.name)).sort((left, right) => {
    const score = (path: string) => terms.reduce((total, term) => total + (path.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
    return score(right.path) - score(left.path);
  });
  const paths = [...new Set([
    ...(pathInAgentScope(activeDocument.path, scope) ? [activeDocument.path] : []),
    ...documents.filter((document) => !document.standalone && pathInAgentScope(document.path, scope)).map((document) => document.path),
    ...(scope.kind === 'files' ? scope.paths : []),
    ...candidates.slice(0, 8).map((file) => file.path),
  ])].slice(0, 10);
  const importPattern = /(?:from\s+['"]|require\s*\(\s*['"]|import\s+['"])([./][^'"]+)/g;
  const references = new Set<string>();
  for (const path of paths) {
    const content = documents.find((document) => document.path === path)?.content;
    if (!content) continue;
    importPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(content)) && references.size < 10) {
      const resolved = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '').split('/');
      for (const part of match[1].split('/')) {
        if (part === '..') resolved.pop(); else if (part !== '.') resolved.push(part);
      }
      const target = resolved.join('/');
      if (candidates.some((file) => file.path === target || file.path === `${target}.ts` || file.path === `${target}.tsx` || file.path === `${target}.js`)) references.add(target);
    }
  }
  paths.push(...references);
  const contexts: AiFileProposal[] = [];
  for (const path of [...new Set(paths)]) {
    const opened = documents.find((document) => document.path === path);
    if (opened) {
      contexts.push({ path, original: opened.content, modified: opened.content, language: opened.language, metadata: opened });
      continue;
    }
    const read = await window.electronAPI.workspace.readTextFile(workspacePath, path);
    if (!read.success || !read.data || read.data.content.length > 200_000) continue;
    const language = languageIdFromName(path);
    contexts.push({
      path, original: read.data.content, modified: read.data.content, language,
      metadata: {
        path, name: path.split(/[\\/]/).pop() ?? path, content: read.data.content,
        savedContent: read.data.content, language, encoding: read.data.encoding,
        lineEnding: read.data.lineEnding, mixedLineEndings: read.data.mixedLineEndings,
        modifiedAt: read.data.modifiedAt, readOnly: read.data.readOnly, pinned: true,
      },
    });
  }
  return contexts;
}

function parseProposals(response: string, contexts: AiFileProposal[], scope: AgentEditScope): AiFileProposal[] {
  const json = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(json) as { files?: Array<{ path: string; oldPath?: string; content: string }> };
  const allowed = new Map(contexts.map((context) => [context.path.replace(/\\/g, '/'), context]));
  return (parsed.files ?? []).flatMap((file) => {
    const path = file.path.replace(/\\/g, '/');
    const previousPath = file.oldPath?.replace(/\\/g, '/');
    const context = allowed.get(previousPath ?? path);
    if (typeof file.content !== 'string' || !SAFE_PATH.test(file.path) || file.path.includes('..') || !pathInAgentScope(path, scope) || (previousPath && !pathInAgentScope(previousPath, scope))) return [];
    if (previousPath) {
      if (!context || !file.content || previousPath === path) return [];
      return [{ ...context, path, previousPath, modified: file.content, language: languageIdFromName(path) }];
    }
    if (!context) return file.content ? [{ path, original: '', modified: file.content, language: languageIdFromName(path) }] : [];
    if (file.content === context.original) return [];
    return [{ ...context, modified: file.content, language: context.language }];
  });
}

export function useAiEditGeneration(options: UseAiEditGenerationOptions) {
  const {
    sessionId, scope, aiApi, workspace, isolated = false, documents, activeDocument, editorRef, aiInstruction, aiMessages,
    setAiMessages, aiMode, aiMultiFile, aiTokenBudget, inlineEdit, setInlineEdit, setAiEditing,
    setAiPendingRequest, setAiProposals, setDiffView, setDocuments, recordAiSession,
    appendOutput, setStatus,
  } = options;
  const requestAbortRef = useRef<AbortController | null>(null);
  const [aiExecutionStage, setAiExecutionStage] = useState<AiExecutionStage>('idle');
  const metricsRef = useRef<AiExecutionMetrics | null>(null);
  const lastMetricsPublishRef = useRef(0);
  const [aiExecutionMetrics, setAiExecutionMetrics] = useState<AiExecutionMetrics | null>(null);
  const [aiReasoningText, setAiReasoningText] = useState('');
  const trackResponseChunk = useCallback((delta: string) => {
    const current = metricsRef.current;
    if (!current || !delta) return;
    const now = Date.now();
    current.receivedChars += delta.length;
    current.firstChunkAt ??= now;
    if (now - lastMetricsPublishRef.current >= 100) {
      lastMetricsPublishRef.current = now;
      setAiExecutionMetrics({ ...current });
    }
  }, []);

  const cancelAiEdit = useCallback(() => {
    if (!requestAbortRef.current) return;
    setAiExecutionStage('cancelling');
    requestAbortRef.current.abort();
    setStatus('正在取消 Agent 请求…');
  }, [setStatus]);

  const generateAiEdit = useCallback(async () => {
    const scopedMultiFile = aiMultiFile || scope.kind !== 'workspace';
    if (aiMode === "modify" && !activeDocument && !scopedMultiFile) { setStatus("修改模式需要打开文件或选择目录/文件范围"); return; }
    if (scope.kind !== 'workspace' && scope.paths.length === 0) { setStatus(`请先在 Explorer 中选择${scope.kind === 'directory' ? '目录' : '文件'}`); return; }
    if (!aiInstruction.trim()) return;
    if (!aiApi.apiKey) { setStatus('请先在设置中配置 AI API'); return; }
    if (requestAbortRef.current) return;
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    metricsRef.current = { startedAt: Date.now(), receivedChars: 0 };
    setAiReasoningText('');
    lastMetricsPublishRef.current = 0;
    setAiExecutionMetrics({ ...metricsRef.current });
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAiPendingRequest({ id: requestId, instruction: aiInstruction.trim(), startedAt: Date.now(), status: 'running' });
    setAiEditing(true);
    setStatus(aiMode === 'analyze' ? 'Agent 正在分析…' : `AI 正在修改 ${activeDocument?.name ?? '工作区'}…`);
    try {
      let executionDocument = activeDocument;
      if (isolated && workspace && activeDocument) {
        const read = await window.electronAPI.workspace.readTextFile(workspace.path, activeDocument.path);
        if (!read.success || !read.data) throw new Error(read.error ?? 'ISOLATED_FILE_READ_FAILED');
        executionDocument = {
          ...activeDocument,
          content: read.data.content,
          savedContent: read.data.content,
          encoding: read.data.encoding,
          lineEnding: read.data.lineEnding,
          modifiedAt: read.data.modifiedAt,
          readOnly: read.data.readOnly,
        };
      }
      let conversation = aiMessages;
      if (conversationNeedsSummary(conversation, aiTokenBudget) && conversation.length > 4) {
        setAiExecutionStage('summarizing');
        const prompt = [
          ...conversation.map(({ role, content }) => ({ role, content })),
          { role: 'user' as const, content: '请压缩以上代码编辑会话：保留用户目标、已决定的方案、修改过的文件、未解决问题和约束。只返回简洁摘要。' },
        ];
        const summaryTask = await executeAgentTask({
          sessionId: sessionId ?? requestId, workspaceRoot: workspace?.path ?? '', executionRoot: isolated ? workspace?.path : undefined,
          instruction: '压缩代码编辑会话', modelConfig: aiApi, multiFile: false, tokenBudget: 4_000, messages: prompt,
        }, abortController.signal, (stage, message) => { setAiExecutionStage(stage === 'generating' ? 'summarizing' : 'parsing'); appendOutput(message); });
        const summary = summaryTask.result?.rawResponse ?? '';
        trackResponseChunk(summary);
        conversation = applyConversationSummary(conversation, summary);
        setAiMessages(conversation);
        appendOutput(`AI 长会话已压缩为摘要，保留最近 ${Math.min(4, aiMessages.length)} 条消息`);
      }
      const history = conversation.slice(-12).map(({ role, content }) => ({ role, content }));
      let response = '';
      if (aiMode === 'analyze') {
        let context = executionDocument ? `\n\n当前文件：${executionDocument.path}\n${executionDocument.content}` : '';
        if (workspace) {
          setAiExecutionStage('collecting-context');
          const fallbackDoc = executionDocument ?? { path: '', name: 'workspace', content: '', savedContent: '', language: 'plaintext', encoding: 'utf8' as const, lineEnding: 'LF' as const, modifiedAt: Date.now(), readOnly: false, pinned: false, mixedLineEndings: false };
          const contexts = await collectContexts(workspace.path, isolated ? [] : documents, fallbackDoc, aiInstruction, scope);
          if (contexts.length === 0) throw new Error(`所选${scope.kind === 'workspace' ? '工作区' : scope.kind === 'directory' ? '目录' : '文件'}中没有可读取的文本文件`);
          const fitted = fitContextToTokenBudget(contexts.map((item) => ({ path: item.path, content: item.original, priority: scope.kind === 'files' ? 100 : 50 })), aiTokenBudget);
          context = `\n\n分析范围：${scope.label}\n范围内文件：\n${fitted.files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}`;
          if (fitted.omitted.length > 0) appendOutput(`分析上下文受 Token 预算限制，省略 ${fitted.omitted.length} 个低优先级文件`);
        }
        const messages = [
          { role: 'system', content: '你是代码分析助手。用户已授权并由应用附加了所选范围内的项目文件；必须基于消息中的“范围内文件”进行分析，不要声称无法访问项目。使用 Markdown 输出，并按“## 分析过程”、“## 依据”、“## 风险”、“## 建议”组织内容。“分析过程”应是可公开审查的简明推理摘要，不输出隐藏思维链。不要生成可直接应用的文件候选。若上下文不足，请准确列出还需要读取的相对路径。' },
          ...history,
          { role: 'user', content: `${aiInstruction.trim()}${context}` },
        ];
        setAiExecutionStage('generating');
        const task = await executeAgentTask({
          sessionId: sessionId ?? requestId, workspaceRoot: workspace?.path ?? '', executionRoot: isolated ? workspace?.path : undefined,
          instruction: aiInstruction.trim(), modelConfig: aiApi, multiFile: false, tokenBudget: aiTokenBudget, messages,
        }, abortController.signal, (stage, _message, delta) => {
          setAiExecutionStage(stage === 'parsing' ? 'parsing' : 'generating');
          if (delta) setAiReasoningText((previous) => previous + delta);
        });
        response = task.result?.rawResponse ?? '';
        trackResponseChunk(response);
        setAiMessages((previous) => [...previous,
          { role: 'user' as const, content: aiInstruction.trim(), timestamp: Date.now() },
          { role: 'assistant' as const, content: response, timestamp: Date.now() },
        ].slice(-100));
        setAiPendingRequest(null);
        setAiExecutionStage('review');
        setStatus('Agent 分析已完成');
        return;
      } else if (scopedMultiFile && workspace) {
        setAiExecutionStage('collecting-context');
        const executionDocuments = isolated ? [] : documents;
        const fallbackDoc = executionDocument || { path: "", name: "workspace", content: "", savedContent: "", language: "plaintext", encoding: "utf8" as const, lineEnding: "LF" as const, modifiedAt: Date.now(), readOnly: false, pinned: false, mixedLineEndings: false };
        const contexts = await collectContexts(workspace.path, executionDocuments, fallbackDoc, aiInstruction, scope);
        abortController.signal.throwIfAborted();
        const fitted = fitContextToTokenBudget(contexts.map((context) => ({
          path: context.path, content: context.original,
          priority: (executionDocument && context.path === executionDocument.path) ? 100 : executionDocuments.some((document) => document.path === context.path) ? 50 : 0,
        })), aiTokenBudget);
        if (fitted.omitted.length) appendOutput(`Token 预算压缩：省略 ${fitted.omitted.length} 个低优先级文件（约 ${fitted.estimatedTokens} tokens）`);
        const messages = [
          { role: 'system' as const, content: '你是多文件代码修改助手。返回严格 JSON：{"files":[{"path":"目标相对路径","oldPath":"重命名前相对路径（仅重命名时）","content":"修改后的完整文件内容"}]}。新建文件：提供 path 和 content。删除文件：content 设为空字符串。重命名：同时提供 oldPath、path 和重命名后的完整 content。只返回需要变更的文件，不得返回 Markdown。' },
          ...history,
          { role: 'user' as const, content: `修改要求：${aiInstruction.trim()}\n\n工作区候选文件：\n${fitted.files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}` },
        ];
        setAiExecutionStage('generating');
        const task = await executeAgentTask({
          sessionId: sessionId ?? requestId, workspaceRoot: workspace.path, executionRoot: isolated ? workspace.path : undefined,
          instruction: aiInstruction.trim(), modelConfig: aiApi, multiFile: true, tokenBudget: aiTokenBudget, messages,
          contextFiles: fitted.files.map((file) => file.path), recovery: { checkpoint: 'context-collected', contextPaths: fitted.files.map((file) => file.path) },
        }, abortController.signal, (stage) => setAiExecutionStage(stage === 'parsing' ? 'parsing' : 'generating'));
        response = task.result?.rawResponse ?? '';
        trackResponseChunk(response);
        setAiExecutionStage('parsing');
        const proposals = parseProposals(response, contexts, scope);
        if (!proposals.length) { setAiPendingRequest(null); setStatus('AI 未生成有效的多文件修改'); return; }
        setAiProposals(proposals);
        recordAiSession(proposals.length);
        const first = proposals[0];
        setDiffView({ ...first, name: first.path, source: 'ai' });
        appendOutput(`AI 已生成 ${proposals.length} 个文件的修改候选`);
      } else {
        const selection = isolated ? null : editorRef.current?.getSelection();
        const selected = selection && !selection.isEmpty() ? editorRef.current?.getModel()?.getValueInRange(selection) : '';
        const messages = [
          { role: 'system' as const, content: '你是代码编辑器中的修改助手。根据要求修改文件。只返回修改后的完整文件内容，不要解释，不要输出 diff。' },
          ...history,
          { role: 'user' as const, content: `文件名：${executionDocument.name}\n语言：${executionDocument.language}\n修改要求：${aiInstruction.trim()}${selected ? `\n重点关注的选中代码：\n${selected}` : ''}\n\n当前完整文件：\n${executionDocument.content}` },
        ];
        setAiExecutionStage('generating');
        const task = await executeAgentTask({
          sessionId: sessionId ?? requestId, workspaceRoot: workspace?.path ?? '', executionRoot: isolated ? workspace?.path : undefined,
          instruction: aiInstruction.trim(), modelConfig: aiApi, multiFile: false, tokenBudget: aiTokenBudget, messages,
          contextFiles: [executionDocument.path], recovery: { checkpoint: 'context-collected', contextPaths: [executionDocument.path] },
        }, abortController.signal, (stage) => setAiExecutionStage(stage === 'parsing' ? 'parsing' : 'generating'));
        response = task.result?.rawResponse ?? '';
        trackResponseChunk(response);
        setAiExecutionStage('parsing');
        const fenced = response.match(/```(?:[\w+-]+)?\s*\n([\s\S]*?)```/);
        const modified = (fenced?.[1] ?? response).trimEnd();
        if (!modified || modified === executionDocument.content.trimEnd()) { setAiPendingRequest(null); setStatus('AI 未生成有效修改'); return; }
        setAiProposals([{
          path: executionDocument.path,
          original: executionDocument.content,
          modified,
          language: executionDocument.language,
          metadata: executionDocument,
        }]);
        setDiffView({ path: executionDocument.path, name: executionDocument.name, original: executionDocument.content, modified, language: executionDocument.language, source: 'ai' });
        recordAiSession(1);
        appendOutput(`AI 已生成 ${executionDocument.name} 的修改候选，等待确认`);
      }
      setAiMessages((previous) => [...previous,
        { role: 'user' as const, content: aiInstruction.trim(), timestamp: Date.now() },
        { role: 'assistant' as const, content: response, timestamp: Date.now() },
      ].slice(-100));
      setAiPendingRequest(null);
      setAiExecutionStage('review');
    } catch (error) {
      setAiPendingRequest((current) => current?.id === requestId ? { ...current, status: 'interrupted' } : current);
      setAiExecutionStage(isAbortError(error) ? 'interrupted' : 'failed');
      setStatus(isAbortError(error) ? 'Agent 请求已取消，可重新运行' : `AI 修改失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (metricsRef.current) {
        metricsRef.current.endedAt = Date.now();
        setAiExecutionMetrics({ ...metricsRef.current });
      }
      if (requestAbortRef.current === abortController) requestAbortRef.current = null;
      setAiEditing(false);
    }
  }, [activeDocument, aiApi, aiInstruction, aiMessages, aiMode, aiMultiFile, aiTokenBudget, appendOutput, documents, editorRef, isolated, recordAiSession, scope, sessionId, setAiEditing, setAiMessages, setAiPendingRequest, setAiProposals, setDiffView, setStatus, trackResponseChunk, workspace]);

  const runInlineEdit = useCallback(async () => {
    if (!activeDocument || !inlineEdit.instruction.trim() || !aiApi.apiKey) return;
    const instruction = inlineEdit.instruction.trim();
    setInlineEdit({ instruction: '', visible: false });
    setAiEditing(true);
    setStatus('AI 正在生成内联修改…');
    try {
      const selection = editorRef.current?.getSelection();
      const selected = selection && !selection.isEmpty() ? editorRef.current?.getModel()?.getValueInRange(selection) : '';
      const task = await executeAgentTask({
        sessionId: sessionId ?? `inline-${Date.now()}`, workspaceRoot: workspace?.path ?? '', executionRoot: isolated ? workspace?.path : undefined,
        instruction, modelConfig: aiApi, multiFile: false, tokenBudget: 8_000, messages: [
        { role: 'system', content: '你是内联代码助手。在光标处或选中代码处进行修改。只返回要插入的代码片段，不要解释，不要 Markdown。如果选中了代码，返回替换该选区的代码。' },
        { role: 'user', content: `${selected ? `选中代码：\n${selected}\n\n` : ''}${activeDocument.name} (${activeDocument.language})\n修改指令：${instruction}` },
        ],
      }, new AbortController().signal, () => undefined);
      const response = task.result?.rawResponse ?? '';
      const snippet = response.replace(/```[\s\S]*?\n?/g, '').trim();
      if (!snippet) { setStatus('AI 未生成有效代码'); return; }
      editorRef.current?.focus();
      if (selection && !selection.isEmpty()) editorRef.current?.executeEdits('ai-inline', [{ range: selection, text: snippet }]);
      else {
        const position = editorRef.current?.getPosition();
        if (position) editorRef.current?.executeEdits('ai-inline', [{ range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: snippet }]);
      }
      setDocuments((previous) => previous.map((document) => document.path === activeDocument.path
        ? { ...document, content: editorRef.current?.getValue() ?? document.content, pinned: true }
        : document));
      appendOutput(`AI 内联修改已应用：${activeDocument.name}`);
      setStatus('AI 内联修改已应用');
    } catch (error) { setStatus(`内联修改失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setAiEditing(false); }
  }, [activeDocument, aiApi, appendOutput, editorRef, inlineEdit.instruction, isolated, sessionId, setAiEditing, setDocuments, setInlineEdit, setStatus, workspace?.path]);

  return { generateAiEdit, cancelAiEdit, runInlineEdit, aiExecutionStage, aiExecutionMetrics, aiReasoningText };
}
