import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Bubble, Sender, Conversations, Welcome, Prompts, ThoughtChain, Suggestion, Attachments } from '@ant-design/x';
import { XProvider } from '@ant-design/x';
import type { BubbleProps } from '@ant-design/x';
import { ConfigProvider, theme as antTheme, notification } from 'antd';
import { XMarkdown } from '@ant-design/x-markdown';
import {
  BookOpen, Bot, ChevronDown, Copy, Database, Download, ExternalLink,
  FileText, FolderOpen, Globe, MessageSquare, PanelLeft, PanelRight, Paperclip, Plus, RefreshCw, Robot,
  RotateCcw, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Wrench, X,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { useChatSession, MODELS, toBubbleItems } from './useChatSession';
import { ToolCallCard } from './MessageBubble';
import { setToolEnabled } from '@/core/tools';
import { ToolManagerDialog } from './ToolManagerDialog';
import { McpApprovalDialog } from './McpApprovalDialog';
import { PromptManagerDialog } from './PromptManagerDialog';
import { RoleManagerDialog } from './RoleManagerDialog';
import { MemoryManagerDialog } from './MemoryManagerDialog';
import { VariableFillDialog } from '@/components/VariableFillDialog';
import { buildAttachmentContext, parseAttachment } from './attachment-parser';
import { conversationMemory, type MemoryCitation } from '@/core/conversation-memory';
import { MemoryDocumentDialog, MemorySourceList, type MemoryDocumentPreview } from './MemorySourceView';
import { configureCodeWorkspace } from '@/core/tools/code-workspace-tools';
import { CodeChangeDiff, type CodeChangeDiffData } from './CodeChangeDiff';
import { createOpenAIProvider, type ChatMessage } from '@/core';

interface ChatAttachment {
  key: string;
  uid: string;
  name: string;
  size: number;
  file: File;
  parseStatus: 'pending' | 'parsing' | 'ready' | 'error';
  error?: string;
}

// ── 常量 ──
const ALL_TOOLS = [
  'get_current_time', 'calculator', 'web_search', 'read_file',
  'clipboard_read', 'fetch_url', 'write_file', 'list_files',
  'read_file_content', 'read_pdf_document', 'read_word_document',
  'read_excel_spreadsheet', 'read_ppt_presentation', 'open_image',
  'search_conversation_history', 'read_conversation_document',
  'workspace_list_files', 'workspace_read_file', 'workspace_write_file', 'workspace_edit_file',
];

export type ChatScene = 'chat' | 'code' | 'workbench';

const SCENE_PRESETS: Record<ChatScene, {
  title: string;
  description: string;
  systemPrompt: string;
  enabledToolIds: string[];
}> = {
  chat: {
    title: 'AI 对话',
    description: '适合问答、写作、总结和日常交流',
    systemPrompt: '你是通用对话助手。回答应清晰、准确；除非用户明确要求，不要修改本地文件。',
    enabledToolIds: ['get_current_time', 'calculator', 'web_search', 'fetch_url', 'search_conversation_history', 'read_conversation_document'],
  },
  code: {
    title: '代码编程',
    description: '面向代码分析、调试、实现和工程任务',
    systemPrompt: `你是代码编程 Agent。优先理解现有代码和工程约束，并使用 workspace_* 工具完成任务。
当用户明确要求修改、修复、实现、重构或删除代码时，该请求本身就是对本次工作区修改的授权：直接读取相关文件并执行修改，不要再次询问“是否确认”“是否继续”或只提供修改建议。
只有目标文件或需求存在会显著改变结果的歧义、操作超出已选择工作区、或文件版本冲突时才暂停询问。修改完成后简要列出已改文件和验证结果。`,
    enabledToolIds: ['calculator', 'web_search', 'fetch_url', 'workspace_list_files', 'workspace_read_file', 'workspace_write_file', 'workspace_edit_file', 'open_image'],
  },
  workbench: {
    title: '工作台',
    description: '可组合文件、知识库和插件工具完成综合任务',
    systemPrompt: '你是工作台助手。根据任务选择合适的文件、知识库和插件工具，先确认上下文，再分步骤完成工作。',
    enabledToolIds: ALL_TOOLS,
  },
};

const MARKDOWN_RESPONSE_PROMPT = `回答使用清晰、规范的 Markdown 排版：
- 使用简短标题建立层级，避免用粗体代替所有标题；
- 段落、列表和代码块之间保留空行；
- 对真正适合横向比较的数据使用表格，普通说明不要强行制表；
- 代码必须使用带语言标识的 fenced code block；
- 避免过深的标题层级和冗长连续段落。`;

const WELCOME_PROMPTS = [
  { key: '1', icon: <FileText className="h-4 w-4" />, label: '帮我写一份项目周报', value: '帮我写一份项目周报' },
  { key: '2', icon: <Sparkles className="h-4 w-4" />, label: '解释这段代码的逻辑', value: '解释这段代码的逻辑' },
  { key: '3', icon: <Globe className="h-4 w-4" />, label: '将以下内容翻译成英文', value: '将以下内容翻译成英文' },
  { key: '4', icon: <Wrench className="h-4 w-4" />, label: '帮我调试一个错误', value: '帮我调试一个错误' },
];

const SUGGESTION_ITEMS = [
  { key: '1', icon: <Sparkles className="h-3.5 w-3.5" />, label: '详细展开', value: '请更详细地展开说明' },
  { key: '2', icon: <FileText className="h-3.5 w-3.5" />, label: '总结要点', value: '请总结成要点列表' },
  { key: '3', icon: <Globe className="h-3.5 w-3.5" />, label: '翻译成英文', value: '请翻译成英文' },
];

function stableDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const ReasoningPanel: React.FC<{ content?: string; streaming?: boolean }> = ({ content = '', streaming = false }) => {
  const [open, setOpen] = useState(true);
  if (!content && !streaming) return null;
  return (
    <div className={`relative mb-2 overflow-hidden rounded-lg border bg-primary/[0.03] transition-all duration-300 ${streaming ? 'border-primary/40 shadow-sm shadow-primary/10' : 'border-primary/15'}`}>
      {streaming && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-primary to-transparent" />}
      <button type="button" className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-primary/5 ${streaming ? 'bg-primary/[0.04]' : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {streaming && <span className="absolute inset-0 animate-ping rounded-md bg-primary/20" />}
          <Sparkles className={`relative h-3 w-3 ${streaming ? 'animate-pulse' : ''}`} />
        </span>
        <span className="flex-1 font-medium text-foreground">{streaming ? 'AI 正在思考' : '思考过程'}</span>
        {streaming && <span className="inline-flex items-end gap-0.5" aria-label="正在思考">
          {[0, 1, 2].map((index) => <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${index * 140}ms`, animationDuration: '900ms' }} />)}
        </span>}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="border-t border-primary/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {content ? <div className="relative"><XMarkdown content={content} streaming={{ hasNextChunk: streaming }} className="chat-markdown prose prose-sm max-w-none text-muted-foreground dark:prose-invert" />{streaming && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-middle" />}</div> : <span className="inline-flex items-center gap-2"><span className="relative flex gap-0.5">{[0, 1, 2].map((index) => <span key={index} className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${index * 140}ms`, animationDuration: '900ms' }} />)}</span>正在分析任务和工作区上下文…</span>}
      </div>}
    </div>
  );
};

// ════════════════════════════════════════
// 主面板
// ════════════════════════════════════════

export const ChatPanel: React.FC<{ scene?: ChatScene; active?: boolean }> = ({ scene = 'chat', active = true }) => {
  const scenePreset = SCENE_PRESETS[scene];
  const roles = useStore((state) => state.roles);
  const activeRoleId = useStore((state) => state.activeRoleId);
  const activeRole = roles.find((role) => role.id === activeRoleId);
  const [codeWorkspace, setCodeWorkspace] = useState<{ path: string; name: string } | null>(() => {
    if (scene !== 'code') return null;
    try { return JSON.parse(localStorage.getItem('ai-chat.code-workspace') ?? 'null'); }
    catch { return null; }
  });
  const [workspaceChanges, setWorkspaceChanges] = useState<Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    gitStatus: string;
    timestamp: number;
    original: string;
    modified: string;
  }>>([]);
  const workspaceSnapshotsRef = useRef<Map<string, string>>(new Map());
  const [changesPanelOpen, setChangesPanelOpen] = useState(true);
  const [workspaceScanPending, setWorkspaceScanPending] = useState(false);
  const [codeChangeDiff, setCodeChangeDiff] = useState<CodeChangeDiffData | null>(null);
  const sceneSystemPrompt = useMemo(() => [
    scenePreset.systemPrompt,
    activeRole?.systemPrompt,
    MARKDOWN_RESPONSE_PROMPT,
    scene === 'code' && codeWorkspace
      ? `当前已授权代码工作区：${codeWorkspace.path}。使用 workspace_* 工具分析和修改其中的代码；工具路径参数必须使用相对路径。`
      : '',
  ].filter(Boolean).join('\n\n'), [activeRole?.systemPrompt, codeWorkspace, scene, scenePreset.systemPrompt]);
  const setActiveActivity = useStore((s) => s.setActiveActivity);
  const theme = useStore((s) => s.theme);
  const aiApi = useStore((s) => s.aiApi);
  const [toolManagerOpen, setToolManagerOpen] = useState(false);
  const [agentTraceOpen, setAgentTraceOpen] = useState(scene === 'code');
  const [memoryScopePickerOpen, setMemoryScopePickerOpen] = useState(false);
  const [knowledgeFolders, setKnowledgeFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [knowledgeFoldersLoading, setKnowledgeFoldersLoading] = useState(false);
  const [savingToKnowledge, setSavingToKnowledge] = useState(false);
  const [promptManagerOpen, setPromptManagerOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [memoryPreview, setMemoryPreview] = useState<MemoryDocumentPreview | null>(null);
  const [memoryPreviewSources, setMemoryPreviewSources] = useState<MemoryCitation[]>([]);
  const senderRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notifApi, contextHolder] = notification.useNotification();

  // 附件上传处理
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) {
      notifApi.warning({
        message: '文件夹中没有可选择的文件',
        description: '空文件夹不会产生附件条目。',
      });
      return;
    }
    const batchId = Date.now();
    setAttachments((prev) => [
      ...prev,
      ...Array.from(files).map((f, i): ChatAttachment => ({
        key: `f-${batchId}-${i}`,
        uid: `f-${batchId}-${i}`,
        name: f.webkitRelativePath || f.name,
        size: f.size,
        file: f,
        parseStatus: 'pending',
      })),
    ]);
  }, [notifApi]);

  const {
    sessions, activeSessionId, setActiveSessionId, showHistory, setShowHistory,
    messages, systemPrompt, currentModel, compareModels, hasKey,
    input, setInput, streaming, agentMode, setAgentMode, memoryEnabled, setMemoryEnabled, memoryDirectories, setMemoryDirectories, error,
    sysPromptOpen, setSysPromptOpen,
    pendingInputPrompt, setPendingInputPrompt, confirmInputPrompt,
    handleNewSession, handleDeleteSession, handleRenameSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear, handleRetry,
    handleEditConfirm,
    updateSessionMeta,
    boundPromptIds, toggleBoundPrompt,
  } = useChatSession(sceneSystemPrompt, scene);

  const [auditModel, setAuditModel] = useState(() => (
    MODELS.find((model) => model.value !== currentModel)?.value ?? currentModel
  ));
  const [auditContent, setAuditContent] = useState('');
  const [auditError, setAuditError] = useState('');
  const [auditStreaming, setAuditStreaming] = useState(false);
  const [auditPanelOpen, setAuditPanelOpen] = useState(true);
  const [auditPanelResizing, setAuditPanelResizing] = useState(false);
  const [auditPanelWidth, setAuditPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('ai-chat.audit-panel-width'));
    return Number.isFinite(saved) && saved >= 240 && saved <= 1280 ? saved : 500;
  });
  const auditAbortRef = useRef<AbortController | null>(null);

  const startAuditPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = auditPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    setAuditPanelResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const handleMove = (moveEvent: PointerEvent) => {
      setAuditPanelWidth(Math.max(240, Math.min(1280, startWidth + startX - moveEvent.clientX)));
    };
    const handleUp = (upEvent: PointerEvent) => {
      const width = Math.max(240, Math.min(1280, startWidth + startX - upEvent.clientX));
      setAuditPanelWidth(width);
      setAuditPanelResizing(false);
      localStorage.setItem('ai-chat.audit-panel-width', String(width));
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [auditPanelWidth]);

  useEffect(() => {
    if (auditModel === currentModel) {
      setAuditModel(MODELS.find((model) => model.value !== currentModel)?.value ?? currentModel);
    }
  }, [auditModel, currentModel]);

  useEffect(() => () => auditAbortRef.current?.abort(), []);

  useEffect(() => {
    auditAbortRef.current?.abort();
    auditAbortRef.current = null;
    setAuditContent('');
    setAuditError('');
    setAuditStreaming(false);
  }, [activeSessionId]);

  const runConversationAudit = useCallback(async () => {
    const reviewable = messages.filter((message) => (
      (message.role === 'user' || message.role === 'assistant') && message.content.trim()
    ));
    if (reviewable.length === 0 || auditStreaming) return;

    const transcript = reviewable.slice(-16).map((message, index) => (
      `### ${index + 1}. ${message.role === 'user' ? '用户' : `AI（${message.model ?? currentModel}）`}\n${message.content}`
    )).join('\n\n').slice(-36000);
    const controller = new AbortController();
    auditAbortRef.current = controller;
    setAuditContent('');
    setAuditError('');
    setAuditStreaming(true);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const auditMessages: ChatMessage[] = [
        {
          role: 'system',
          content: `你是独立的 AI 问答评审专家。请审查另一位 AI 与用户的对话，不要盲从原回答，也不要只做措辞或代码风格点评。

评审重点按以下优先级执行：
1. 问答正确性：判断 AI 是否准确理解用户意图，结论、事实、推理和操作建议是否正确，是否真正解决了用户问题。
2. 场景完整性：指出回答没有考虑到的使用场景，包括正常流程、边界条件、异常与失败路径、不同用户状态、数据状态、权限、安全、并发、性能、兼容性、可恢复性和实际操作体验。只列与当前问题确实相关的场景，不要机械罗列。
3. 风险与依据：识别前后矛盾、无依据假设、过度承诺、越权操作以及缺少验证的结论。

如果原回答错误或不完整，请给出你独立理解后的正确答案、补充分析和可执行建议。证据不足时明确说明需要验证什么，不要编造。
使用中文 Markdown，按“正确性结论、错误或不合理之处、遗漏的场景、独立分析与建议”组织。先给结论，再给依据；没有问题的部分简要说明即可。`,
        },
        { role: 'user', content: `请评审以下当前会话：\n\n${transcript}` },
      ];
      let result = '';
      for await (const chunk of provider.chat(auditMessages, {
        model: auditModel,
        temperature: 0.2,
        maxTokens: 4000,
        signal: controller.signal,
      })) {
        result += chunk.delta;
        setAuditContent(result);
      }
      if (!result.trim()) setAuditError('评审模型没有返回内容');
    }
    catch (error) {
      if ((error as Error).name !== 'AbortError') setAuditError((error as Error).message || '评审失败');
    }
    finally {
      if (auditAbortRef.current === controller) auditAbortRef.current = null;
      setAuditStreaming(false);
    }
  }, [aiApi.apiKey, aiApi.baseUrl, auditModel, auditStreaming, currentModel, messages]);

  const stopConversationAudit = useCallback(() => {
    auditAbortRef.current?.abort();
    auditAbortRef.current = null;
    setAuditStreaming(false);
  }, []);

  useEffect(() => {
    if (scene === 'code') setAgentMode(true);
  }, [scene, setAgentMode]);

  useEffect(() => {
    if (scene !== 'code') return;
    configureCodeWorkspace(codeWorkspace?.path ?? null);
    if (codeWorkspace) {
      localStorage.setItem('ai-chat.code-workspace', JSON.stringify(codeWorkspace));
      void window.electronAPI.workspace.reauthorize(codeWorkspace.path);
    }
    return () => configureCodeWorkspace(null);
  }, [codeWorkspace, scene]);

  useEffect(() => {
    if (scene !== 'code' || !codeWorkspace) return;
    let disposed = false;
    setWorkspaceChanges([]);
    setWorkspaceScanPending(true);
    workspaceSnapshotsRef.current.clear();

    const initializeSnapshots = async () => {
      const listed = await window.electronAPI.workspace.listFiles(codeWorkspace.path);
      if (!listed.success || disposed) return;
      const files = (listed.data ?? []).filter((entry) => entry.type === 'file' && (entry.size ?? 0) <= 1024 * 1024);
      for (let index = 0; index < files.length && !disposed; index += 20) {
        const batch = files.slice(index, index + 20);
        const contents = await Promise.all(batch.map((file) => window.electronAPI.workspace.readTextFile(codeWorkspace.path, file.path)));
        batch.forEach((file, fileIndex) => {
          const result = contents[fileIndex];
          if (result.success && result.data) workspaceSnapshotsRef.current.set(file.path, result.data.content);
        });
      }
      if (disposed) return;

      const gitStatus = await window.electronAPI.workspace.gitStatus(codeWorkspace.path);
      if (gitStatus.success && gitStatus.data?.length) {
        const initialChanges: typeof workspaceChanges = [];
        for (let index = 0; index < gitStatus.data.length && !disposed; index += 20) {
          const batch = gitStatus.data.slice(index, index + 20);
          const comparisons = await Promise.all(batch.map(async (entry) => {
            const [head, current] = await Promise.all([
              window.electronAPI.workspace.gitShowHead(codeWorkspace.path, entry.path),
              workspaceSnapshotsRef.current.has(entry.path)
                ? Promise.resolve(null)
                : window.electronAPI.workspace.readTextFile(codeWorkspace.path, entry.path),
            ]);
            const modified = workspaceSnapshotsRef.current.get(entry.path)
              ?? (current?.success && current.data ? current.data.content : '');
            if (current?.success && current.data) workspaceSnapshotsRef.current.set(entry.path, modified);
            const status = entry.status.includes('R')
              ? 'renamed' as const
              : entry.status.includes('D')
                ? 'deleted' as const
                : /[?A]/.test(entry.status)
                  ? 'added' as const
                  : 'modified' as const;
            return {
              path: entry.path,
              status,
              gitStatus: entry.status,
              timestamp: Date.now(),
              original: head.success ? head.data ?? '' : '',
              modified,
            };
          }));
          initialChanges.push(...comparisons);
        }
        if (!disposed) setWorkspaceChanges(initialChanges);
      }
      if (disposed) return;
      setWorkspaceScanPending(false);
      const result = await window.electronAPI.workspace.watch(codeWorkspace.path);
      if (!result.success) notifApi.warning({ message: '文件变化检测不可用', description: result.error });
    };
    void initializeSnapshots().catch((error) => {
      if (!disposed) {
        setWorkspaceScanPending(false);
        notifApi.warning({ message: '无法扫描已有文件变化', description: String(error) });
      }
    });

    const unsubscribe = window.electronAPI.workspace.onFileChanged(async (event) => {
      if (disposed) return;
      const hadSnapshot = workspaceSnapshotsRef.current.has(event.path);
      const original = workspaceSnapshotsRef.current.get(event.path) ?? '';
      const current = await window.electronAPI.workspace.readTextFile(codeWorkspace.path, event.path);
      if (disposed) return;
      const modified = current.success && current.data ? current.data.content : '';
      if (original === modified) return;
      if (current.success) workspaceSnapshotsRef.current.set(event.path, modified);
      else workspaceSnapshotsRef.current.delete(event.path);
      const status = current.success ? (hadSnapshot ? 'modified' as const : 'added' as const) : 'deleted' as const;
      const gitStatusResult = await window.electronAPI.workspace.gitStatus(codeWorkspace.path);
      const gitEntry = gitStatusResult.success ? gitStatusResult.data?.find((entry) => entry.path === event.path) : undefined;
      if (!gitEntry) {
        setWorkspaceChanges((previous) => previous.filter((item) => item.path !== event.path));
        return;
      }
      setWorkspaceChanges((previous) => [
        { path: event.path, status, gitStatus: gitEntry.status, timestamp: Date.now(), original, modified },
        ...previous.filter((item) => item.path !== event.path),
      ].slice(0, 200));
    });
    return () => {
      disposed = true;
      unsubscribe();
      void window.electronAPI.workspace.unwatch();
    };
  }, [codeWorkspace, notifApi, scene]);

  const refreshWorkspaceChanges = useCallback(async () => {
    if (!codeWorkspace || workspaceScanPending) return;
    setWorkspaceScanPending(true);
    try {
      const gitStatus = await window.electronAPI.workspace.gitStatus(codeWorkspace.path);
      if (!gitStatus.success) {
        notifApi.warning({ message: '刷新文件变化失败', description: gitStatus.error });
        return;
      }
      const refreshed = await Promise.all((gitStatus.data ?? []).map(async (entry) => {
        const [head, current] = await Promise.all([
          window.electronAPI.workspace.gitShowHead(codeWorkspace.path, entry.path),
          window.electronAPI.workspace.readTextFile(codeWorkspace.path, entry.path),
        ]);
        const modified = current.success && current.data ? current.data.content : '';
        if (current.success && current.data) workspaceSnapshotsRef.current.set(entry.path, modified);
        else workspaceSnapshotsRef.current.delete(entry.path);
        const status = entry.status.includes('R')
          ? 'renamed' as const
          : entry.status.includes('D')
            ? 'deleted' as const
            : /[?A]/.test(entry.status)
              ? 'added' as const
              : 'modified' as const;
        return {
          path: entry.path,
          status,
          gitStatus: entry.status,
          timestamp: Date.now(),
          original: head.success ? head.data ?? '' : '',
          modified,
        };
      }));
      setWorkspaceChanges(refreshed);
    } catch (error) {
      notifApi.warning({ message: '刷新文件变化失败', description: String(error) });
    } finally {
      setWorkspaceScanPending(false);
    }
  }, [codeWorkspace, notifApi, workspaceScanPending]);

  const selectCodeWorkspace = useCallback(async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (folder) setCodeWorkspace(folder);
  }, []);

  const openMemoryScopePicker = useCallback(async () => {
    setMemoryScopePickerOpen(true);
    setKnowledgeFoldersLoading(true);
    try {
      const folders = await window.electronAPI.listConversationFolders();
      setKnowledgeFolders(folders);
      const availablePaths = new Set(folders.map((folder) => folder.path));
      setMemoryDirectories((previous) => previous.filter((directory) => availablePaths.has(directory.path)));
    }
    catch { notifApi.error({ message: '无法读取知识库文件夹' }); }
    finally { setKnowledgeFoldersLoading(false); }
  }, [notifApi, setMemoryDirectories]);

  const toggleMemoryDirectory = useCallback((folder: { name: string; path: string }) => {
    setMemoryDirectories((previous) => {
      const next = previous.some((item) => item.path === folder.path)
        ? previous.filter((item) => item.path !== folder.path)
        : [...previous, folder];
      setMemoryEnabled(next.length > 0);
      return next;
    });
  }, [setMemoryDirectories, setMemoryEnabled]);

  const openCodeChangeDiff = useCallback((change: typeof workspaceChanges[number]) => {
    setCodeChangeDiff({ path: change.path, original: change.original, modified: change.modified });
  }, []);

  const stagedWorkspaceChanges = workspaceChanges.filter((change) => {
    const code = change.gitStatus.padEnd(2, ' ').slice(0, 2);
    return !['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code) && code[0] !== ' ' && code[0] !== '?';
  });
  const unstagedWorkspaceChanges = workspaceChanges.filter((change) => {
    const code = change.gitStatus.padEnd(2, ' ').slice(0, 2);
    return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code) || code === '??' || code[1] !== ' ';
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const saveResponseToKnowledge = useCallback(async (content: string) => {
    if (!content.trim() || savingToKnowledge) return;
    const targetFolder = memoryDirectories[0];
    if (!targetFolder) {
      notifApi.info({ message: '请先选择知识库目录', description: '选择目录后再次点击“保存到知识库”' });
      await openMemoryScopePicker();
      return;
    }
    setSavingToKnowledge(true);
    try {
      const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
      const sessionTitle = activeSession?.title && activeSession.title !== '新对话' ? activeSession.title : '';
      const title = (heading || sessionTitle || `AI 回复 ${new Date().toLocaleString('zh-CN')}`).slice(0, 100);
      const saved = await window.electronAPI.saveConversation({
        site: 'ai-chat',
        timestamp: Date.now(),
        requestBody: {},
        responseContent: content,
        title,
        createNew: true,
        contentMode: 'document',
      });
      if (!saved.success || !saved.filePath) throw new Error('知识库文档创建失败');
      const moved = await window.electronAPI.moveConversation(saved.filePath, targetFolder.path);
      if (!moved.success) throw new Error(`文档已创建，但移动到“${targetFolder.name}”失败：${moved.error ?? '未知错误'}`);
      await conversationMemory.sync();
      useStore.getState().notifyConversationSaved();
      notifApi.success({ message: '已保存到知识库', description: targetFolder.name });
    } catch (error) {
      notifApi.error({ message: '保存到知识库失败', description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSavingToKnowledge(false);
    }
  }, [activeSession?.title, memoryDirectories, notifApi, openMemoryScopePicker, savingToKnowledge]);

  const toggleCompareModel = useCallback((model: string) => {
    const selected = compareModels.includes(model)
      ? compareModels.filter((item) => item !== model)
      : [...compareModels, model];
    if (selected.length === 0) return;
    updateSessionMeta({
      model: selected[0],
      compareModels: selected,
    });
  }, [compareModels, updateSessionMeta]);

  // ── 暗色模式 ──
  const [isDark, setIsDark] = useState(
    () => theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  useEffect(() => {
    if (theme !== 'system') { setIsDark(theme === 'dark'); return; }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // ── 错误通知 ──
  useEffect(() => {
    if (error) {
      notifApi.error({ message: '请求失败', description: error, placement: 'bottomRight', duration: 5 });
    }
  }, [error, notifApi]);

  useEffect(() => {
    if (!active) return;
    if (activeRole) {
      const tools = activeRole.enabledToolIds;
      const workspaceTools = scene === 'code'
        ? scenePreset.enabledToolIds.filter((tool) => tool.startsWith('workspace_'))
        : [];
      const permittedTools = tools.length > 0
        ? scenePreset.enabledToolIds.filter((tool) => tools.includes(tool) || workspaceTools.includes(tool))
        : scenePreset.enabledToolIds;
      ALL_TOOLS.forEach((tool) => setToolEnabled(tool, permittedTools.includes(tool)));
    } else {
      ALL_TOOLS.forEach((tool) => setToolEnabled(tool, scenePreset.enabledToolIds.includes(tool)));
    }
  }, [active, activeRoleId, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeRole && systemPrompt.trim() === activeRole.systemPrompt.trim()) {
      updateSessionMeta({ systemPrompt: '' });
    }
  }, [activeRole, systemPrompt, updateSessionMeta]);

  // ── bubbleItems / conversationItems ──
  const latestComparisonId = useMemo(() => {
    return messages[messages.length - 1]?.comparisonId;
  }, [messages]);
  const latestComparison = useMemo(
    () => latestComparisonId
      ? messages.filter((message) => message.comparisonId === latestComparisonId)
      : [],
    [messages, latestComparisonId],
  );
  const bubbleMessages = useMemo(
    () => (latestComparisonId
      ? messages.filter((message) => message.comparisonId !== latestComparisonId)
      : messages).filter((message) => scene !== 'code' || message.role !== 'tool'),
    [messages, latestComparisonId, scene],
  );
  const bubbleItems = useMemo(
    () => toBubbleItems(bubbleMessages, streaming && latestComparison.length === 0, error),
    [bubbleMessages, streaming, latestComparison.length, error],
  );
  const conversationItems = useMemo(() =>
    [...sessions].sort((a, b) => b.createdAt - a.createdAt).map((s) => ({
      key: s.id, label: s.title, group: stableDate(s.createdAt),
    })), [sessions]);

  // ── Sender 提交（含附件处理 + 自动聚焦） ──
  const onSenderSubmit = useCallback(async (text: string) => {
    if (attachments.length === 0) {
      setInput('');
      await handleSend(text);
      setTimeout(() => senderRef.current?.focus(), 50);
      return;
    }
    if (attachments.some((attachment) => attachment.parseStatus === 'error')) {
      notifApi.error({
        message: '存在无法读取的文件',
        description: '请移除标记为失败的文件后再发送。',
      });
      return;
    }

    setAttachments((current) =>
      current.map((attachment) => ({ ...attachment, parseStatus: 'parsing' }))
    );
    const results = await Promise.allSettled(
      attachments.map((attachment) => parseAttachment(attachment.file))
    );
    const parsed = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const failedIndexes = new Map<number, string>();
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedIndexes.set(
          index,
          result.reason instanceof Error ? result.reason.message : '解析失败',
        );
      }
    });

    if (failedIndexes.size > 0) {
      setAttachments((current) => current.map((attachment, index) => ({
        ...attachment,
        parseStatus: failedIndexes.has(index) ? 'error' : 'ready',
        error: failedIndexes.get(index),
      })));
      return;
    }
    if (parsed.length === 0) return;

    const names = parsed.map((file) => file.name).join(', ');
    const displayText = text
      ? `[附件：${names}]\n${text}`
      : `[附件：${names}]\n请阅读并分析附件内容。`;
    const contextText = [
      buildAttachmentContext(parsed),
      text || '请阅读并分析以上附件内容。',
    ].join('\n\n');

    setInput('');
    setAttachments([]);
    await handleSend(displayText, contextText);
    setTimeout(() => senderRef.current?.focus(), 50);
  }, [handleSend, setInput, attachments, notifApi]);

  // ── 提示词点击 → 填充到输入框（不自动发送） ──
  const onPromptClick = useCallback((info: { data: { key: string; label: string; value: string } }) => {
    setInput(info.data.value);
    senderRef.current?.focus();
  }, [setInput]);

  // ── Suggestion 点击 → 直接发送 ──
  const onSuggestionSelect = useCallback((value: string) => {
    handleSend(value);
  }, [handleSend]);

  // ── URL 点击 → 弹层预览 ──
  const handleMessageClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && anchor.href && /^https?:\/\//.test(anchor.href)) {
      e.preventDefault();
      setPreviewUrl(anchor.href);
    }
  }, []);

  const showSuggestion = useMemo(() => {
    if (streaming || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return last?.role === 'assistant' && last.content.trim().length > 0;
  }, [messages, streaming]);

  const openMemorySource = useCallback(async (source: MemoryCitation, sources?: MemoryCitation[]) => {
    const result = await window.electronAPI.readConversation(source.filePath);
    let content = result.success ? result.content ?? '' : '';
    if (!result.success) {
      const normalizedFile = source.filePath.replace(/\\/g, '/');
      const directory = memoryDirectories.find((item) => {
        const root = item.path.replace(/\\/g, '/').replace(/\/$/, '');
        return normalizedFile === root || normalizedFile.startsWith(`${root}/`);
      });
      if (directory) {
        const root = directory.path.replace(/\\/g, '/').replace(/\/$/, '');
        const relativePath = normalizedFile.slice(root.length).replace(/^\//, '');
        const workspaceResult = await window.electronAPI.workspace.readTextFile(directory.path, relativePath);
        if (workspaceResult.success && workspaceResult.data) content = workspaceResult.data.content;
        else {
          notifApi.error({ message: '无法读取知识库文档', description: workspaceResult.error });
          return;
        }
      } else {
        notifApi.error({ message: '无法读取知识库文档', description: result.error });
        return;
      }
    }
    if (sources) setMemoryPreviewSources(sources);
    setMemoryPreview({ source, content });
  }, [memoryDirectories, notifApi]);

  // ── Sources 数据（Agent 工具结果中的搜索引用） ──
  const sourcesItems = useMemo(() => {
    if (!agentMode) return [];
    return messages
      .filter((m) => m.role === 'tool' && m.toolCalls?.some((c) => c.name === 'web_search' || c.name === 'fetch_url'))
      .flatMap((m) =>
        (m.toolResults || []).map((r, i) => ({
          key: `${m.id}-${i}`,
          title: r.name || '搜索结果',
          content: (r.output || '').slice(0, 200),
        }))
      );
  }, [agentMode, messages]);

  // ── ThoughtChain ──
  const thoughtChainItems = useMemo(() => {
    if (!agentMode || messages.length === 0) return [];
    const items: { title: string; description: string; status: 'success' | 'error' }[] = [];
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') { lastUserIndex = index; break; }
    }
    const traceMessages = messages.slice(Math.max(0, lastUserIndex));
    const task = traceMessages.find((message) => message.role === 'user');
    if (task) items.push({ title: '分析任务', description: task.content.slice(0, 120), status: 'success' });
    for (const m of traceMessages) {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const targets = m.toolCalls.map((call) => typeof call.arguments.path === 'string' ? call.arguments.path : call.name);
        items.push({ title: `执行 ${m.toolCalls.length} 个工具`, description: targets.join('、'), status: 'success' });
      } else if (m.role === 'tool') {
        const failed = m.toolResults?.filter((result) => result.error) ?? [];
        const completed = (m.toolResults?.length ?? 0) - failed.length;
        const description = failed.length
          ? failed.map((result) => `${result.name}: ${result.error}`).join('；')
          : `${completed} 个工具执行成功，结果已加入 Agent 上下文`;
        items.push({ title: failed.length ? '执行异常' : '获取上下文', description,
          status: m.toolResults?.some((r) => r.error) ? 'error' : 'success' });
      } else if (m.role === 'assistant' && m.content.trim()) {
        items.push({ title: '生成结果', description: m.content.slice(0, 120), status: 'success' });
      }
    }
    const finalAssistant = [...traceMessages].reverse().find((message) => message.role === 'assistant');
    if (finalAssistant?.toolCalls?.length && finalAssistant.toolResults?.length && finalAssistant.content.trim()) {
      items.push({ title: '生成结果', description: finalAssistant.content.slice(0, 120), status: 'success' });
    }
    return items;
  }, [agentMode, messages]);

  const latestAgentReasoning = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') { lastUserIndex = index; break; }
    }
    return messages
      .slice(Math.max(0, lastUserIndex + 1))
      .filter((message) => message.role === 'assistant' && message.reasoning?.trim())
      .map((message) => message.reasoning?.trim() ?? '')
      .join('\n\n');
  }, [messages]);

  // ── 自定义消息渲染 ──
  const contentRender: BubbleProps['contentRender'] = (content, info) => {
    const extra = (info as any)?.extraInfo;
    const origRole = extra?.originalRole as string | undefined;
    const toolCalls = extra?.toolCalls;
    const toolResults = extra?.toolResults;
    const memorySources = extra?.memorySources as MemoryCitation[] | undefined;
    const reasoning = extra?.reasoning as string | undefined;
    const reasoningStreaming = Boolean(streaming && extra?.isLastAi);
    const text = typeof content === 'string' ? content : String(content ?? '');

    if (origRole === 'tool') {
      return (
        <div className="my-1 rounded-md border border-warning border-warning bg-warning/10 bg-warning/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-warning text-warning">
            <Wrench className="h-3 w-3" /> 工具结果
          </div>
          <div className="mt-1 text-xs text-warning text-warning">
            {text ? <XMarkdown content={text} className="text-xs" /> : null}
          </div>
        </div>
      );
    }
    if (origRole === 'assistant') {
      const showAgentTrace = scene === 'code' && agentMode && extra?.isLastAi
        && (streaming || thoughtChainItems.length > 0 || latestAgentReasoning);
      return (
        <div>
          {showAgentTrace && <div className="mb-2 overflow-hidden rounded-lg border bg-background">
            <div className="flex h-9 items-center hover:bg-accent/40">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs" onClick={() => setAgentTraceOpen((open) => !open)} aria-expanded={agentTraceOpen}>
                <span className={`h-2 w-2 rounded-full ${streaming ? 'animate-pulse bg-warning' : 'bg-success'}`} />
                <span className="font-medium">{streaming ? 'Agent 正在执行' : 'Agent 执行完成'}</span>
                <span className="text-muted-foreground">{Math.max(1, thoughtChainItems.length)} 个步骤</span>
                <span className="flex-1" />
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${agentTraceOpen ? 'rotate-180' : ''}`} />
              </button>
              {streaming && <Button type="button" size="sm" variant="ghost" className="mr-1 h-6 px-2 text-[10px] text-destructive" onClick={handleStop}>停止</Button>}
            </div>
            {agentTraceOpen && <div className="max-h-80 overflow-y-auto border-t px-3 py-2">
              <div className="relative space-y-2 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
                {(thoughtChainItems.length ? thoughtChainItems : [{ title: '分析任务', description: '正在理解请求并规划下一步操作', status: 'success' as const }]).map((item, index, items) => {
                  const activeStep = streaming && index === items.length - 1;
                  return <div key={`${item.title}-${index}`} className={`relative flex gap-3 rounded-sm pl-5 text-xs transition-colors ${activeStep ? 'bg-primary/[0.03]' : ''}`}>
                    <span className={`absolute left-0 top-1 h-2.5 w-2.5 rounded-full border-2 border-background ${item.status === 'error' ? 'bg-destructive' : activeStep ? 'animate-pulse bg-warning' : 'bg-success'}`} />
                    {activeStep && <span className="absolute left-0 top-1 h-2.5 w-2.5 animate-ping rounded-full bg-warning/40" />}
                    <div className="min-w-0"><p className="font-medium">{item.title}{activeStep && <span className="ml-1.5 text-[9px] font-normal text-warning">进行中</span>}</p><p className="truncate text-[10px] text-muted-foreground" title={item.description}>{item.description}</p></div>
                  </div>;
                })}
              </div>
              <div className="mt-3 border-t pt-3"><ReasoningPanel content={latestAgentReasoning} streaming={streaming} /></div>
            </div>}
          </div>}
          {scene !== 'code' && <ReasoningPanel content={reasoning} streaming={reasoningStreaming} />}
          {toolCalls && toolCalls.length > 0 && <ToolCallCard calls={toolCalls} results={toolResults} />}
          {text && <XMarkdown content={text} streaming={{ hasNextChunk: streaming }} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />}
          {!!memorySources?.length && !streaming && <MemorySourceList sources={memorySources} onOpen={(source, sources) => void openMemorySource(source, sources)} />}
        </div>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  };

  const showSysPrompt = !activeRole && (sysPromptOpen || (!!systemPrompt && messages.length === 0));

  return (
    <ConfigProvider theme={{ algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }}>
      <XProvider>
        {contextHolder}
        <div className="flex-1 flex h-full bg-card">
          {/* 历史记录侧边栏 */}
          {showHistory && (
            <div className="w-64 border-r shrink-0 flex flex-col bg-background overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-semibold text-muted-foreground">对话历史</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHistory(false)} title="收起历史" aria-label="收起对话历史">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <Conversations items={conversationItems} activeKey={activeSessionId}
                  onActiveChange={(key) => { setActiveSessionId(key); setShowHistory(false); }}
                  menu={(conv) => ({
                    items: [{ label: '重命名', key: 'rename' }, { label: '删除', key: 'delete', danger: true }],
                    onClick: (info) => {
                      if (info.key === 'delete') handleDeleteSession(conv.key);
                      if (info.key === 'rename') handleRenameSession(conv.key);
                    },
                  })}
                  groupable creation={{ onClick: handleNewSession }} />
              </div>
            </div>
          )}

          {/* 主聊天区 */}
          <div className="flex-1 flex flex-col h-full min-w-0">
            {/* 头部工具栏 */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 flex-wrap">
              <Button variant="ghost" size="icon" className={`h-7 w-7 ${showHistory ? 'text-primary' : ''}`}
                onClick={() => setShowHistory((visible) => !visible)} title="对话历史"
                aria-label={showHistory ? '收起对话历史' : '展开对话历史'}>
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} title="新建对话"><Plus className="h-4 w-4" /></Button>
              <span className="text-xs font-medium text-muted-foreground truncate max-w-[120px]">{activeSession?.title || '新对话'}</span>
              {scene === 'code' && <button type="button" className={`ml-2 inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-accent ${codeWorkspace ? 'border-border bg-card text-foreground' : 'border-warning/40 bg-warning/5 text-warning'}`} onClick={selectCodeWorkspace} title={codeWorkspace ? `${codeWorkspace.path}\n点击更换工作区` : '选择代码工作区'}>
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{codeWorkspace?.name ?? '选择代码文件夹'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{codeWorkspace ? '更改' : ''}</span>
              </button>}
              <div className="flex-1" />
              <div className="relative">
                <button
                  className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] ${
                    compareModels.length > 1
                      ? 'border-primary/40 bg-primary-light text-primary'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                  onClick={() => setModelPickerOpen((open) => !open)}
                  title="选择一个或多个模型"
                >
                  <Sparkles className="h-3 w-3" />
                  {compareModels.length > 1 ? `${compareModels.length} 个模型对比` : MODELS.find((m) => m.value === currentModel)?.label ?? currentModel}
                  <ChevronDown className={`h-3 w-3 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelPickerOpen && (
                  <div className="absolute right-0 top-7 z-40 min-w-48 rounded-md border bg-card p-2 shadow-lg">
                    <div className="mb-1.5 text-[10px] text-muted-foreground">可多选；Agent 模式仅使用主模型</div>
                    {MODELS.map((model) => (
                      <label key={model.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={compareModels.includes(model.value)}
                          onChange={() => toggleCompareModel(model.value)}
                        />
                        <span>{model.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${agentMode ? 'bg-warning/10 text-warning' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                onClick={() => setAgentMode((v) => !v)} title={agentMode ? '关闭 Agent 模式' : '开启 Agent 模式'} aria-label={agentMode ? '关闭 Agent 模式' : '开启 Agent 模式'} aria-pressed={agentMode}>
                <Sparkles className="h-3.5 w-3.5" />
                {agentMode && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />}
              </button>
              <button className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${memoryEnabled && memoryDirectories.length ? 'bg-primary-light text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                onClick={() => { void openMemoryScopePicker(); }} title="选择知识库检索目录" aria-label="选择知识库检索目录" aria-haspopup="dialog">
                <BookOpen className="h-3.5 w-3.5" />
                {memoryDirectories.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground">{memoryDirectories.length}</span>}
              </button>
              <Button variant="ghost" size="icon" className={`h-7 w-7 ${memoryManagerOpen ? 'bg-primary-light text-primary' : 'text-muted-foreground hover:text-primary'}`}
                onClick={() => setMemoryManagerOpen(true)} title="记忆管理"><Database className="h-3.5 w-3.5" /></Button>
              <button onClick={() => setRoleManagerOpen(true)}
                className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${activeRole ? 'bg-primary-light text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                title={activeRole ? `当前角色：${activeRole.name}` : '角色管理'} aria-label={activeRole ? `角色管理，当前角色：${activeRole.name}` : '角色管理'}>
                <Bot className="h-3.5 w-3.5" />
                {activeRole && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setToolManagerOpen(true)} title="工具管理"><Wrench className="h-3.5 w-3.5" /></Button>
              {!activeRole && <Button variant="ghost" size="icon" className={`h-7 w-7 ${sysPromptOpen || systemPrompt ? 'text-primary' : 'text-muted-foreground'}`}
                onClick={() => setSysPromptOpen((v) => !v)} title="系统提示词" aria-label="系统提示词"><SlidersHorizontal className="h-3.5 w-3.5" /></Button>}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setPromptManagerOpen(true)} title="提示词管理"><MessageSquare className="h-3.5 w-3.5" /></Button>
              {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={handleClear} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></Button>}
              {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={handleExport} title="导出 Markdown"><Download className="h-3.5 w-3.5" /></Button>}
              {!hasKey && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setActiveActivity('settings')} title="配置 AI API" aria-label="配置 AI API"><Settings className="h-3.5 w-3.5" /></Button>}
            </div>

            {/* 系统提示词 */}
            {showSysPrompt && (
              <div className="px-3 py-2 border-b bg-background shrink-0">
                <textarea className="w-full text-xs bg-card border rounded p-2 resize-none text-foreground placeholder:text-muted-foreground"
                  rows={2} placeholder="系统提示词 — 定义 AI 的角色和行为方式..."
                  value={systemPrompt} onChange={(e) => updateSessionMeta({ systemPrompt: e.target.value })} />
              </div>
            )}

            {agentMode && thoughtChainItems.length > 0 && scene !== 'code' && (
              <div className="max-h-40 shrink-0 overflow-y-auto border-b bg-background px-4 py-2">
                <ThoughtChain items={thoughtChainItems} />
              </div>
            )}

            {/* 消息区域 */}
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4" onClick={handleMessageClick}>
                <Welcome variant="borderless" icon={<Robot className="h-10 w-10 text-foreground" />}
                  title={hasKey ? scenePreset.title : '未配置 API Key'}
                  description={hasKey ? scenePreset.description : '请在设置 → AI API 中配置后使用'} />
                {hasKey && (
                  <Prompts items={WELCOME_PROMPTS} onItemClick={onPromptClick}
                    styles={{ list: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } }} />
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto" style={{ height: 0 }} onClick={handleMessageClick}>
                <Bubble.List
                  items={bubbleItems as any}
                  autoScroll
                  style={{ height: latestComparison.length > 0 ? 'auto' : '100%' }}
                  role={{
                    ai: {
                      placement: 'start', variant: 'outlined',
                      typing: streaming ? { effect: 'typing' as const, step: 3, interval: 50 } : false,
                      avatar: (<div className="w-7 h-7 rounded-full bg-success text-white flex items-center justify-center shrink-0"><Robot className="h-3.5 w-3.5" /></div>),
                      header: (_: any, info: any) => {
                        const ts = info?.extraInfo?.timestamp;
                        const model = info?.extraInfo?.model;
                        if (!ts) return null;
                        return <span className="text-[10px] text-muted-foreground">{model ? `${model} · ` : ''}{formatTime(ts)}</span>;
                      },
                      contentRender,
                      footer: (content: any, info: any) => {
                        if (!info?.extraInfo?.isLastAi || streaming) return null;
                        const text = typeof content === 'string' ? content : '';
                        return (
                          <div className="flex gap-2 text-[10px]">
                             <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(text)} title="复制"><Copy className="h-3 w-3" />复制</button>
                             <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={handleRegenerate} title="重新生成"><RotateCcw className="h-3 w-3" />重新生成</button>
                             <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary disabled:cursor-wait disabled:opacity-60" disabled={savingToKnowledge || !text.trim()} onClick={() => { void saveResponseToKnowledge(text); }} title={memoryDirectories[0] ? `保存到知识库：${memoryDirectories[0].name}` : '保存到知识库（请先选择目录）'}><BookOpen className={`h-3 w-3 ${savingToKnowledge ? 'animate-pulse' : ''}`} />{savingToKnowledge ? '保存中…' : '保存到知识库'}</button>
                          </div>
                        );
                      },
                    },
                    user: {
                      placement: 'end', variant: 'filled', contentRender,
                      onEditConfirm: handleEditConfirm,
                      header: (_: any, info: any) => {
                        const ts = info?.extraInfo?.timestamp;
                        if (!ts) return null;
                        return <span className="text-[10px] text-muted-foreground">{formatTime(ts)}</span>;
                      },
                      avatar: (<div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shrink-0"><span className="text-xs font-bold">U</span></div>),
                    },
                    tool: { placement: 'start', variant: 'borderless', contentRender },
                  }} />
                {latestComparison.length > 0 && (
                  <div className="grid grid-cols-1 items-start gap-3 px-4 pb-4 lg:grid-cols-2">
                    {latestComparison.map((message) => (
                      <section
                        key={message.id}
                        className="min-w-0 rounded-lg border border-primary/20 bg-primary-light/40 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between border-b border-primary/15 pb-2 text-xs">
                          <span className="font-semibold text-primary">
                            {MODELS.find((model) => model.value === message.model)?.label ?? message.model}
                          </span>
                          <button
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            disabled={!message.content}
                          >
                            <Copy className="h-3 w-3" />复制
                          </button>
                        </div>
                        {message.content ? (
                          <div>
                            <XMarkdown content={message.content} streaming={{ hasNextChunk: streaming }} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />
                            {!!message.memorySources?.length && !streaming && <MemorySourceList sources={message.memorySources} onOpen={(source, sources) => void openMemorySource(source, sources)} />}
                          </div>
                        ) : (
                          <div className="py-6 text-center text-xs text-muted-foreground">
                            {streaming ? '生成中…' : '暂无回答'}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                )}
                {/* 错误区域 + 重试按钮 */}
                {error && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <p className="text-xs text-destructive">{error}</p>
                    <button className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary" onClick={handleRetry} title="重新发送">
                      <RefreshCw className="h-3.5 w-3.5" />重试
                    </button>
                  </div>
                )}

                {/* Agent 搜索引用源 */}
                {sourcesItems.length > 0 && (
                  <div className="px-4 py-2 border-t border-border">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground"><BookOpen className="h-3 w-3" />引用来源</div>
                    <div className="flex flex-wrap gap-1">
                      {sourcesItems.map((s) => (
                        <span key={s.key} className="text-[10px] px-2 py-0.5 rounded-full bg-primary-light text-primary"
                          title={s.content}>{s.title}</span>
                      ))}
                    </div>
                  </div>
                )}

                {showSuggestion && (
                  <div className="px-4 pb-3">
                    <Suggestion items={SUGGESTION_ITEMS} onSelect={onSuggestionSelect} />
                  </div>
                )}
              </div>
            )}

            {/* 输入区域（含附件） */}
            <div className="border-t shrink-0 bg-background">
              {attachments.length > 0 && (
                <div className="px-3 pt-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>已添加 {attachments.length} 个文件</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="inline-flex items-center gap-1 text-primary hover:text-primary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Plus className="h-3 w-3" />添加文件
                      </button>
                    </div>
                  </div>
                  <Attachments
                    overflow="wrap"
                    maxCount={attachments.length}
                    items={attachments.map((attachment) => ({
                      ...attachment,
                      status: attachment.parseStatus === 'error'
                        ? 'error' as const
                        : attachment.parseStatus === 'parsing'
                          ? 'uploading' as const
                          : 'done' as const,
                      description: attachment.parseStatus === 'parsing'
                        ? '正在读取内容…'
                        : attachment.parseStatus === 'ready'
                          ? '已读取'
                          : attachment.parseStatus === 'error'
                            ? attachment.error
                            : `${(attachment.size / 1024).toFixed(1)} KB · 待读取`,
                    }))}
                    onRemove={(file) => {
                      const id = file.uid || String((file as { key?: string }).key ?? '');
                      setAttachments((prev) =>
                        prev.filter((attachment) => attachment.uid !== id && attachment.key !== id)
                      );
                      return true;
                    }}
                  />
                </div>
              )}
              <div className="p-3">
                {/* 隐藏的文件 input */}
                <input type="file" ref={fileInputRef} className="hidden" multiple
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
                <Sender ref={senderRef} value={input} onChange={setInput}
                  onSubmit={onSenderSubmit} onCancel={handleStop}
                  loading={streaming} disabled={!hasKey}
                  prefix={
                    <div className="flex items-center">
                      <button className="p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => fileInputRef.current?.click()} title="选择文件"
                        aria-label="选择文件" disabled={!hasKey}>
                        <Paperclip className="h-4 w-4" />
                      </button>
                    </div>
                  }
                  placeholder={!hasKey ? '请先在设置中配置 API Key' : agentMode ? 'Agent 模式：输入任务...' : '输入消息... (Enter 发送)'}
                  style={{ borderRadius: 8 }} />
              </div>
            </div>
          </div>

          {scene === 'code' && (
            <aside className={`relative flex shrink-0 flex-col overflow-hidden border-l bg-background ${auditPanelResizing ? '' : 'transition-[width] duration-200'}`} style={{ width: auditPanelOpen ? auditPanelWidth : 40 }} aria-label="AI 回答评审">
              {auditPanelOpen && <div role="separator" aria-orientation="vertical" aria-label="拖拽调整 AI 评审面板宽度" onPointerDown={startAuditPanelResize} className="group absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none">
                <span className="absolute inset-y-0 left-0 w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary group-active:bg-primary" />
              </div>}
              <div className={`flex h-10 shrink-0 items-center border-b ${auditPanelOpen ? 'gap-2 px-3' : 'justify-center'}`}>
                {auditPanelOpen && <>
                  <ShieldCheck className={`h-4 w-4 ${auditStreaming ? 'animate-pulse text-primary' : 'text-primary'}`} />
                  <span className="min-w-0 flex-1 text-xs font-semibold">AI 评审与审计</span>
                  {auditContent && !auditStreaming && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] text-success">已完成</span>}
                </>}
                <Button type="button" variant="ghost" size="icon" className="relative h-7 w-7 shrink-0" onClick={() => setAuditPanelOpen((open) => !open)} title={auditPanelOpen ? '折叠 AI 评审与审计' : '展开 AI 评审与审计'} aria-label={auditPanelOpen ? '折叠 AI 评审与审计' : '展开 AI 评审与审计'}>
                  <PanelRight className={`h-4 w-4 transition-transform ${auditPanelOpen ? '' : 'rotate-180'} ${auditStreaming ? 'animate-pulse text-primary' : auditContent ? 'text-success' : ''}`} />
                  {!auditPanelOpen && (auditStreaming || auditContent) && <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${auditStreaming ? 'animate-pulse bg-primary' : 'bg-success'}`} />}
                </Button>
              </div>
              {auditPanelOpen && <>
                <div className="flex shrink-0 items-center gap-2 border-b p-2">
                <select
                  value={auditModel}
                  onChange={(event) => setAuditModel(event.target.value)}
                  disabled={auditStreaming}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[11px] outline-none focus:border-primary"
                  aria-label="选择评审模型"
                >
                  {MODELS.map((model) => (
                    <option key={model.value} value={model.value} disabled={model.value === currentModel}>
                      {model.label}{model.value === currentModel ? '（当前模型）' : ''}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 px-3 text-[11px]"
                  disabled={!hasKey || messages.every((message) => message.role !== 'assistant')}
                  onClick={auditStreaming ? stopConversationAudit : () => { void runConversationAudit(); }}
                >
                  {auditStreaming ? '停止' : auditContent ? '重新评审' : '开始评审'}
                </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {auditError ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                    <div className="font-medium">评审失败</div>
                    <div className="mt-1 break-words text-[10px] leading-4">{auditError}</div>
                  </div>
                ) : auditContent ? (
                  <div className="relative">
                    {auditStreaming && <div className="mb-2 flex items-center gap-2 text-[10px] text-primary"><span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary" />另一个 AI 正在独立审查…</div>}
                    <XMarkdown content={auditContent} streaming={{ hasNextChunk: auditStreaming }} className="chat-markdown prose prose-sm max-w-none text-xs dark:prose-invert" />
                  </div>
                ) : auditStreaming ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-3 text-center">
                    <div className="relative mb-4 flex h-14 w-14 items-center justify-center">
                      <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/10" />
                      <span className="absolute inset-1 animate-pulse rounded-2xl border border-primary/30 bg-primary/5" />
                      <ShieldCheck className="relative h-6 w-6 animate-pulse text-primary" />
                    </div>
                    <div className="text-xs font-medium text-foreground">评审 AI 正在思考</div>
                    <div className="mt-3 flex items-end gap-1" aria-label="正在思考">
                      {[0, 1, 2].map((index) => <span key={index} className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${index * 150}ms`, animationDuration: '900ms' }} />)}
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-muted-foreground">正在检查回答的事实、推理、遗漏和改进空间…</p>
                  </div>
                ) : (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-3 text-center text-muted-foreground">
                    <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></span>
                    <div className="text-xs font-medium text-foreground">独立评审当前对话</div>
                    <p className="mt-1.5 text-[10px] leading-4">使用另一个模型检查回答的准确性、遗漏、矛盾和不合理建议，并给出独立分析。</p>
                  </div>
                )}
                </div>
                <div className="shrink-0 border-t px-3 py-2 text-[9px] leading-4 text-muted-foreground">
                  评审内容独立显示，不会写入原对话；最多读取最近 16 条用户与 AI 消息。
                </div>
              </>}
            </aside>
          )}

          {scene === 'code' && codeWorkspace && (
            <aside className={`${changesPanelOpen ? 'w-72' : 'w-10'} flex shrink-0 flex-col overflow-hidden border-l bg-background transition-[width] duration-200`} aria-label="文件变化">
              <div className={`flex h-10 shrink-0 items-center border-b ${changesPanelOpen ? 'justify-between px-3' : 'justify-center'}`}>
                {changesPanelOpen && (
                  <div className="flex min-w-0 items-center gap-2">
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={workspaceScanPending} onClick={() => { void refreshWorkspaceChanges(); }} title="刷新文件变化" aria-label="刷新文件变化">
                      <RefreshCw className={`h-3.5 w-3.5 ${workspaceScanPending ? 'animate-spin text-primary' : workspaceChanges.length ? 'text-warning' : 'text-muted-foreground'}`} />
                    </Button>
                    <span className="text-xs font-semibold">文件变化</span>
                    {workspaceChanges.length > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">{workspaceChanges.length}</span>}
                  </div>
                )}
                <Button type="button" variant="ghost" size="icon" className="relative h-7 w-7" onClick={() => setChangesPanelOpen((open) => !open)} title={changesPanelOpen ? '折叠文件变化' : `展开文件变化${workspaceChanges.length ? `（${workspaceChanges.length}）` : ''}`}>
                  <PanelRight className={`h-4 w-4 transition-transform ${changesPanelOpen ? '' : 'rotate-180'} ${!changesPanelOpen && workspaceChanges.length ? 'text-warning' : ''}`} />
                  {!changesPanelOpen && workspaceChanges.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-warning px-1 text-[9px] leading-4 text-white">{workspaceChanges.length}</span>}
                </Button>
              </div>
              {changesPanelOpen && (
                <>
                  <div className="flex-1 overflow-y-auto p-2">
                    {workspaceScanPending ? (
                      <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-[10px] text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span>正在扫描已有变化…</span>
                      </div>
                    ) : workspaceChanges.length === 0 ? (
                      <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-[10px] text-muted-foreground">
                        <RefreshCw className="h-5 w-5" />
                        <span>正在监听工作区<br />暂无文件变化</span>
                      </div>
                    ) : (
                      <>
                        <div className="mb-1 flex items-center px-1 py-1 text-[10px] font-semibold text-muted-foreground">
                          <span>Changes</span><span className="ml-1.5 rounded bg-muted px-1.5 py-0.5">{unstagedWorkspaceChanges.length}</span>
                        </div>
                        {unstagedWorkspaceChanges.length === 0 && <div className="mb-2 px-1 py-2 text-[10px] text-muted-foreground">暂无未暂存变更</div>}
                        {unstagedWorkspaceChanges.map((change) => (
                          <button type="button" key={`unstaged:${change.path}`} className="mb-1 w-full rounded-md border bg-card px-2.5 py-2 text-left hover:border-primary/40 hover:bg-accent/40" onClick={() => openCodeChangeDiff(change)} title="查看未暂存变更">
                            <div className="flex items-center gap-2">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${change.status === 'added' ? 'bg-success' : change.status === 'deleted' ? 'bg-destructive' : change.status === 'renamed' ? 'bg-primary' : 'bg-warning'}`} />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={change.path}>{change.path.split(/[\\/]/).pop()}</span>
                              <span className="text-[9px] text-muted-foreground">{formatTime(change.timestamp)}</span>
                            </div>
                            <div className="mt-1 truncate pl-3.5 text-[10px] text-muted-foreground" title={change.path}>{{ added: '新增', modified: '已修改', deleted: '已删除', renamed: '已重命名' }[change.status]} · {change.path}</div>
                          </button>
                        ))}
                        <div className="mb-1 mt-3 flex items-center border-t px-1 pt-3 text-[10px] font-semibold text-muted-foreground">
                          <span>Staged Changes</span><span className="ml-1.5 rounded bg-muted px-1.5 py-0.5">{stagedWorkspaceChanges.length}</span>
                        </div>
                        {stagedWorkspaceChanges.length === 0 && <div className="px-1 py-2 text-[10px] text-muted-foreground">暂无已暂存变更</div>}
                        {stagedWorkspaceChanges.map((change) => (
                          <button type="button" key={`staged:${change.path}`} className="mb-1 w-full rounded-md border border-success/25 bg-success/5 px-2.5 py-2 text-left hover:border-success/50 hover:bg-success/10" onClick={() => openCodeChangeDiff(change)} title="查看已暂存变更">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={change.path}>{change.path.split(/[\\/]/).pop()}</span>
                              <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">已暂存</span>
                            </div>
                            <div className="mt-1 truncate pl-3.5 text-[10px] text-muted-foreground" title={change.path}>{{ added: '新增', modified: '已修改', deleted: '已删除', renamed: '已重命名' }[change.status]} · {change.path}</div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  {workspaceChanges.length > 0 && (
                    <div className="shrink-0 border-t p-2">
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-full text-[10px]" onClick={() => setWorkspaceChanges([])}>清除记录</Button>
                    </div>
                  )}
                </>
              )}
            </aside>
          )}

          <ToolManagerDialog open={toolManagerOpen} onClose={() => setToolManagerOpen(false)} />
          <McpApprovalDialog />
          <PromptManagerDialog open={promptManagerOpen} onClose={() => setPromptManagerOpen(false)}
            boundPromptIds={boundPromptIds} onToggleBound={toggleBoundPrompt} />
          <RoleManagerDialog open={roleManagerOpen} onClose={() => setRoleManagerOpen(false)} />
          <MemoryManagerDialog open={memoryManagerOpen} onClose={() => setMemoryManagerOpen(false)} />
          {pendingInputPrompt && (
            <VariableFillDialog
              content={pendingInputPrompt.content}
              variables={pendingInputPrompt.variables}
              onConfirm={(_content, values) => confirmInputPrompt(values)}
              onCancel={() => setPendingInputPrompt(null)}
            />
          )}
        </div>

        {memoryScopePickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setMemoryScopePickerOpen(false)}>
            <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="memory-scope-title" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <BookOpen className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1"><h2 id="memory-scope-title" className="text-sm font-semibold">选择知识库目录</h2><p className="mt-0.5 text-[10px] text-muted-foreground">仅检索知识库模块中勾选目录内的文档</p></div>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setMemoryScopePickerOpen(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {knowledgeFoldersLoading ? <div className="p-8 text-center text-xs text-muted-foreground">正在读取知识库目录…</div>
                  : knowledgeFolders.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground"><FolderOpen className="mx-auto mb-2 h-7 w-7 opacity-50" /><p>知识库中暂无目录</p><p className="mt-1 text-[10px]">请先在知识库模块中新建目录并整理文档</p></div>
                    : knowledgeFolders.map((folder) => {
                      const selected = memoryDirectories.some((item) => item.path === folder.path);
                      return <label key={folder.path} className={`mb-1 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${selected ? 'border-primary/40 bg-primary/5' : 'hover:bg-accent/50'}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleMemoryDirectory(folder)} />
                        <FolderOpen className={`h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{folder.name}</span><span className="block truncate text-[10px] text-muted-foreground" title={folder.path}>{folder.path}</span></span>
                      </label>;
                    })}
              </div>
              <div className="flex items-center gap-3 border-t px-4 py-3 text-[10px] text-muted-foreground">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={memoryEnabled} disabled={memoryDirectories.length === 0} onChange={(event) => setMemoryEnabled(event.target.checked)} /><span>启用知识检索</span></label>
                <span>已选择 {memoryDirectories.length} 个目录</span>
                <Button type="button" size="sm" className="ml-auto h-7 px-3 text-xs" onClick={() => setMemoryScopePickerOpen(false)}>完成</Button>
              </div>
            </div>
          </div>
        )}

        {/* URL 预览弹层 */}
        {previewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewUrl(null)}>
            <div className="bg-card rounded-lg shadow-2xl overflow-hidden" style={{ width: '90vw', height: '85vh' }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background bg-muted">
                <span className="text-xs text-muted-foreground truncate max-w-[80%]">{previewUrl}</span>
                <div className="flex gap-1">
                  <button className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { const api = (window as any).electronAPI; api?.shell?.openExternal?.(previewUrl); }}>
                    <ExternalLink className="h-3.5 w-3.5" />浏览器打开
                  </button>
                  <button className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setPreviewUrl(null)}><X className="h-3.5 w-3.5" />关闭</button>
                </div>
              </div>
              <webview src={previewUrl} style={{ width: '100%', height: 'calc(100% - 37px)' }} />
            </div>
          </div>
        )}
        <MemoryDocumentDialog preview={memoryPreview} sources={memoryPreviewSources}
          onNavigate={(source) => void openMemorySource(source)} onClose={() => setMemoryPreview(null)} />
        {codeChangeDiff && <CodeChangeDiff value={codeChangeDiff} dark={isDark} onClose={() => setCodeChangeDiff(null)} />}
      </XProvider>
    </ConfigProvider>
  );
};
