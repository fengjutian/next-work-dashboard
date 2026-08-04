import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { createOpenAIProvider } from '../../core/llm';
import { fitContextToTokenBudget } from './ai-context';
import { applyConversationSummary, conversationNeedsSummary, isAbortError, type AiConversationMessage, type AiPendingRequest } from './ai-conversation';
import { languageIdFromName } from './editor-utils';
import type { OpenDocument } from './editor-types';
import type { AiFileProposal } from './useAiSessionState';
import type { EditorDiffView } from './useGitDiffMerge';

interface AiApiConfig { apiKey: string; baseUrl: string; model: string }

export type AiExecutionStage = 'idle' | 'collecting-context' | 'summarizing' | 'generating' | 'parsing' | 'review' | 'cancelling' | 'interrupted' | 'failed';
export interface AiExecutionMetrics { startedAt: number; firstChunkAt?: number; endedAt?: number; receivedChars: number }

interface UseAiEditGenerationOptions {
  aiApi: AiApiConfig;
  workspace: { path: string } | null;
  isolated?: boolean;
  documents: OpenDocument[];
  activeDocument: OpenDocument | null;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  aiInstruction: string;
  aiMessages: AiConversationMessage[];
  setAiMessages: Dispatch<SetStateAction<AiConversationMessage[]>>;
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

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|go|rs|java|vue|svelte)$/i;
const SAFE_PATH = /^[\w./-]+$/;

async function collectContexts(
  workspacePath: string,
  documents: OpenDocument[],
  activeDocument: OpenDocument,
  instruction: string,
) {
  const listed = await window.electronAPI.workspace.listFiles(workspacePath);
  const terms = instruction.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2);
  const candidates = (listed.data ?? []).filter((file) => SOURCE_FILE.test(file.name)).sort((left, right) => {
    const score = (path: string) => terms.reduce((total, term) => total + (path.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
    return score(right.path) - score(left.path);
  });
  const paths = [...new Set([
    activeDocument.path,
    ...documents.filter((document) => !document.standalone).map((document) => document.path),
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

function parseProposals(response: string, contexts: AiFileProposal[]): AiFileProposal[] {
  const json = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(json) as { files?: Array<{ path: string; oldPath?: string; content: string }> };
  const allowed = new Map(contexts.map((context) => [context.path.replace(/\\/g, '/'), context]));
  return (parsed.files ?? []).flatMap((file) => {
    const path = file.path.replace(/\\/g, '/');
    const previousPath = file.oldPath?.replace(/\\/g, '/');
    const context = allowed.get(previousPath ?? path);
    if (typeof file.content !== 'string' || !SAFE_PATH.test(file.path) || file.path.includes('..')) return [];
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
    aiApi, workspace, isolated = false, documents, activeDocument, editorRef, aiInstruction, aiMessages,
    setAiMessages, aiMultiFile, aiTokenBudget, inlineEdit, setInlineEdit, setAiEditing,
    setAiPendingRequest, setAiProposals, setDiffView, setDocuments, recordAiSession,
    appendOutput, setStatus,
  } = options;
  const requestAbortRef = useRef<AbortController | null>(null);
  const [aiExecutionStage, setAiExecutionStage] = useState<AiExecutionStage>('idle');
  const metricsRef = useRef<AiExecutionMetrics | null>(null);
  const lastMetricsPublishRef = useRef(0);
  const [aiExecutionMetrics, setAiExecutionMetrics] = useState<AiExecutionMetrics | null>(null);
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
    if (!activeDocument || !aiInstruction.trim()) return;
    if (!aiApi.apiKey) { setStatus('请先在设置中配置 AI API'); return; }
    if (requestAbortRef.current) return;
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    metricsRef.current = { startedAt: Date.now(), receivedChars: 0 };
    lastMetricsPublishRef.current = 0;
    setAiExecutionMetrics({ ...metricsRef.current });
    setAiExecutionStage(aiMultiFile ? 'collecting-context' : 'generating');
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAiPendingRequest({ id: requestId, instruction: aiInstruction.trim(), startedAt: Date.now(), status: 'running' });
    setAiEditing(true);
    setStatus(`AI 正在修改 ${activeDocument.name}…`);
    try {
      let executionDocument = activeDocument;
      if (isolated && workspace) {
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
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      let conversation = aiMessages;
      if (conversationNeedsSummary(conversation, aiTokenBudget) && conversation.length > 4) {
        setAiExecutionStage('summarizing');
        let summary = '';
        const prompt = [
          ...conversation.map(({ role, content }) => ({ role, content })),
          { role: 'user' as const, content: '请压缩以上代码编辑会话：保留用户目标、已决定的方案、修改过的文件、未解决问题和约束。只返回简洁摘要。' },
        ];
        for await (const chunk of provider.chat(prompt, { model: aiApi.model, temperature: 0.1, maxTokens: 2000, signal: abortController.signal })) { summary += chunk.delta; trackResponseChunk(chunk.delta); }
        conversation = applyConversationSummary(conversation, summary);
        setAiMessages(conversation);
        appendOutput(`AI 长会话已压缩为摘要，保留最近 ${Math.min(4, aiMessages.length)} 条消息`);
      }
      const history = conversation.slice(-12).map(({ role, content }) => ({ role, content }));
      let response = '';
      if (aiMultiFile && workspace) {
        setAiExecutionStage('collecting-context');
        const executionDocuments = isolated ? [] : documents;
        const contexts = await collectContexts(workspace.path, executionDocuments, executionDocument, aiInstruction);
        abortController.signal.throwIfAborted();
        const fitted = fitContextToTokenBudget(contexts.map((context) => ({
          path: context.path, content: context.original,
          priority: context.path === executionDocument.path ? 100 : executionDocuments.some((document) => document.path === context.path) ? 50 : 0,
        })), aiTokenBudget);
        if (fitted.omitted.length) appendOutput(`Token 预算压缩：省略 ${fitted.omitted.length} 个低优先级文件（约 ${fitted.estimatedTokens} tokens）`);
        const messages = [
          { role: 'system' as const, content: '你是多文件代码修改助手。返回严格 JSON：{"files":[{"path":"目标相对路径","oldPath":"重命名前相对路径（仅重命名时）","content":"修改后的完整文件内容"}]}。新建文件：提供 path 和 content。删除文件：content 设为空字符串。重命名：同时提供 oldPath、path 和重命名后的完整 content。只返回需要变更的文件，不得返回 Markdown。' },
          ...history,
          { role: 'user' as const, content: `修改要求：${aiInstruction.trim()}\n\n工作区候选文件：\n${fitted.files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}` },
        ];
        setAiExecutionStage('generating');
        for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.15, maxTokens: Math.min(24_000, Math.max(2_000, Math.floor(aiTokenBudget / 2))), signal: abortController.signal })) { response += chunk.delta; trackResponseChunk(chunk.delta); }
        setAiExecutionStage('parsing');
        const proposals = parseProposals(response, contexts);
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
        for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.2, maxTokens: Math.min(16_000, Math.max(2_000, Math.floor(aiTokenBudget / 2))), signal: abortController.signal })) { response += chunk.delta; trackResponseChunk(chunk.delta); }
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
  }, [activeDocument, aiApi, aiInstruction, aiMessages, aiMultiFile, aiTokenBudget, appendOutput, documents, editorRef, isolated, recordAiSession, setAiEditing, setAiMessages, setAiPendingRequest, setAiProposals, setDiffView, setStatus, trackResponseChunk, workspace]);

  const runInlineEdit = useCallback(async () => {
    if (!activeDocument || !inlineEdit.instruction.trim() || !aiApi.apiKey) return;
    const instruction = inlineEdit.instruction.trim();
    setInlineEdit({ instruction: '', visible: false });
    setAiEditing(true);
    setStatus('AI 正在生成内联修改…');
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const selection = editorRef.current?.getSelection();
      const selected = selection && !selection.isEmpty() ? editorRef.current?.getModel()?.getValueInRange(selection) : '';
      let response = '';
      for await (const chunk of provider.chat([
        { role: 'system', content: '你是内联代码助手。在光标处或选中代码处进行修改。只返回要插入的代码片段，不要解释，不要 Markdown。如果选中了代码，返回替换该选区的代码。' },
        { role: 'user', content: `${selected ? `选中代码：\n${selected}\n\n` : ''}${activeDocument.name} (${activeDocument.language})\n修改指令：${instruction}` },
      ], { model: aiApi.model, temperature: 0.1, maxTokens: 4000 })) response += chunk.delta;
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
  }, [activeDocument, aiApi, appendOutput, editorRef, inlineEdit.instruction, setAiEditing, setDocuments, setInlineEdit, setStatus]);

  return { generateAiEdit, cancelAiEdit, runInlineEdit, aiExecutionStage, aiExecutionMetrics };
}
