import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Bubble, Sender, Conversations, Welcome, Prompts, ThoughtChain, Suggestion, Attachments } from '@ant-design/x';
import { XProvider } from '@ant-design/x';
import type { BubbleProps } from '@ant-design/x';
import { ConfigProvider, theme as antTheme, notification } from 'antd';
import { XMarkdown } from '@ant-design/x-markdown';
import { Wrench, MessageSquare, Trash2, Plus, Download, ArrowLeft, ArrowRight, Bot, Robot } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { useChatSession, MODELS, toBubbleItems } from './chat/useChatSession';
import { ToolCallCard } from './chat/MessageBubble';
import { setToolEnabled } from '@/core/tools';
import { ToolManagerDialog } from './chat/ToolManagerDialog';
import { PromptManagerDialog } from './chat/PromptManagerDialog';
import { RoleManagerDialog } from './chat/RoleManagerDialog';
import { buildAttachmentContext, parseAttachment } from './chat/attachment-parser';

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
];

const WELCOME_PROMPTS = [
  { key: '1', label: '📝 帮我写一份项目周报', value: '帮我写一份项目周报' },
  { key: '2', label: '🔍 解释这段代码的逻辑', value: '解释这段代码的逻辑' },
  { key: '3', label: '🌐 将以下内容翻译成英文', value: '将以下内容翻译成英文' },
  { key: '4', label: '🐛 帮我调试一个错误', value: '帮我调试一个错误' },
];

const SUGGESTION_ITEMS = [
  { key: '1', label: '👍 详细展开', value: '请更详细地展开说明' },
  { key: '2', label: '📋 总结要点', value: '请总结成要点列表' },
  { key: '3', label: '🌐 翻译成英文', value: '请翻译成英文' },
];

function stableDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ════════════════════════════════════════
// 主面板
// ════════════════════════════════════════

export const ChatPanel: React.FC = () => {
  const setActiveActivity = useStore((s) => s.setActiveActivity);
  const theme = useStore((s) => s.theme);
  const [toolManagerOpen, setToolManagerOpen] = useState(false);
  const [promptManagerOpen, setPromptManagerOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
    input, setInput, streaming, agentMode, setAgentMode, error,
    sysPromptOpen, setSysPromptOpen,
    handleNewSession, handleDeleteSession, handleRenameSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear, handleRetry,
    handleEditConfirm,
    updateSessionMeta,
    boundPromptIds, toggleBoundPrompt,
  } = useChatSession();

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

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

  // ── 角色 Agent ──
  const roles = useStore((s) => s.roles);
  const activeRoleId = useStore((s) => s.activeRoleId);
  const activeRole = roles.find((r) => r.id === activeRoleId);

  useEffect(() => {
    if (activeRole) {
      updateSessionMeta({ systemPrompt: activeRole.systemPrompt });
      const tools = activeRole.enabledToolIds;
      if (tools.length > 0) ALL_TOOLS.forEach((t) => setToolEnabled(t, tools.includes(t)));
      else ALL_TOOLS.forEach((t) => setToolEnabled(t, true));
    } else {
      ALL_TOOLS.forEach((t) => setToolEnabled(t, true));
    }
  }, [activeRoleId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () => latestComparisonId
      ? messages.filter((message) => message.comparisonId !== latestComparisonId)
      : messages,
    [messages, latestComparisonId],
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
    for (const m of messages) {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        items.push({ title: '🤔 思考', description: m.content?.slice(0, 120) || '分析中...', status: 'success' });
        items.push({ title: `🔧 ${m.toolCalls.map((c) => c.name).join(', ')}`, description: '执行工具调用', status: 'success' });
      } else if (m.role === 'tool') {
        const res = m.toolResults?.map((r) => r.error ? `❌ ${r.error}` : (r.output || '').slice(0, 120)).join(', ') || '';
        items.push({ title: '📋 结果', description: res,
          status: m.toolResults?.some((r) => r.error) ? 'error' : 'success' });
      }
    }
    return items;
  }, [agentMode, messages]);

  // ── 自定义消息渲染 ──
  const contentRender: BubbleProps['contentRender'] = (content, info) => {
    const extra = (info as any)?.extraInfo;
    const origRole = extra?.originalRole as string | undefined;
    const toolCalls = extra?.toolCalls;
    const toolResults = extra?.toolResults;
    const text = typeof content === 'string' ? content : String(content ?? '');

    if (origRole === 'tool') {
      return (
        <div className="my-1 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Wrench className="h-3 w-3" /> 工具结果
          </div>
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            {text ? <XMarkdown content={text} className="text-xs" /> : null}
          </div>
        </div>
      );
    }
    if (origRole === 'assistant') {
      return (
        <div>
          {toolCalls && toolCalls.length > 0 && <ToolCallCard calls={toolCalls} results={toolResults} />}
          {text && <XMarkdown content={text} streaming={{ hasNextChunk: streaming }} className="text-sm" />}
        </div>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  };

  const showSysPrompt = sysPromptOpen || (!!systemPrompt && messages.length === 0);

  return (
    <ConfigProvider theme={{ algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }}>
      <XProvider>
        {contextHolder}
        <div className="flex-1 flex h-full bg-white dark:bg-zinc-950">
          {/* 历史记录侧边栏 */}
          {showHistory && (
            <div className="w-64 border-r shrink-0 flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-semibold text-zinc-500">对话历史</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHistory(false)}>
                  <span className="text-xs">✕</span>
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} title="新建对话"><Plus className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className={`h-7 w-7 ${showHistory ? 'text-blue-500' : ''}`}
                onClick={() => setShowHistory(!showHistory)} title="对话历史">
                {showHistory ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Button>
              <span className="text-xs font-medium text-zinc-500 truncate max-w-[120px]">{activeSession?.title || '新对话'}</span>
              <div className="flex-1" />
              <div className="relative">
                <button
                  className={`h-6 text-[10px] rounded border px-2 ${
                    compareModels.length > 1
                      ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                      : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                  }`}
                  onClick={() => setModelPickerOpen((open) => !open)}
                  title="选择一个或多个模型"
                >
                  {compareModels.length > 1 ? `${compareModels.length} 个模型对比` : MODELS.find((m) => m.value === currentModel)?.label ?? currentModel}
                </button>
                {modelPickerOpen && (
                  <div className="absolute right-0 top-7 z-40 min-w-48 rounded-md border bg-white dark:bg-zinc-900 p-2 shadow-lg">
                    <div className="mb-1.5 text-[10px] text-zinc-400">可多选；Agent 模式仅使用主模型</div>
                    {MODELS.map((model) => (
                      <label key={model.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
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
              <button className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors ${agentMode ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}
                onClick={() => setAgentMode((v) => !v)}>{agentMode ? 'Agent ✓' : 'Agent'}</button>
              <button onClick={() => setRoleManagerOpen(true)}
                className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors flex items-center gap-1 ${activeRole ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600'}`} title="角色管理">
                <Bot className="h-3 w-3" /><span>{activeRole ? activeRole.name : '角色'}</span></button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setToolManagerOpen(true)} title="工具管理"><Wrench className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className={`h-7 w-7 text-[10px] ${sysPromptOpen || systemPrompt ? 'text-blue-500' : 'text-zinc-400'}`}
                onClick={() => setSysPromptOpen((v) => !v)} title="系统提示词">Sys</Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setPromptManagerOpen(true)} title="提示词管理"><MessageSquare className="h-3.5 w-3.5" /></Button>
              {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></Button>}
              {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={handleExport} title="导出 Markdown"><Download className="h-3.5 w-3.5" /></Button>}
              {!hasKey && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')}><span className="text-xs">⚙</span></Button>}
            </div>

            {/* 系统提示词 */}
            {showSysPrompt && (
              <div className="px-3 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0">
                <textarea className="w-full text-xs bg-white dark:bg-zinc-800 border rounded p-2 resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
                  rows={2} placeholder="系统提示词 — 定义 AI 的角色和行为方式..."
                  value={systemPrompt} onChange={(e) => updateSessionMeta({ systemPrompt: e.target.value })} />
              </div>
            )}

            {/* Agent 思考链 */}
            {agentMode && thoughtChainItems.length > 0 && (
              <div className="px-4 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0 max-h-40 overflow-y-auto">
                <ThoughtChain items={thoughtChainItems} />
              </div>
            )}

            {/* 消息区域 */}
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4" onClick={handleMessageClick}>
                <Welcome variant="borderless" icon={<Robot className="h-10 w-10 text-zinc-300" />}
                  title={hasKey ? 'AI 对话' : '未配置 API Key'}
                  description={hasKey ? '输入消息开始对话，可开启 Agent 模式自动调用工具' : '请在设置 → AI API 中配置后使用'} />
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
                      avatar: (<div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><Robot className="h-3.5 w-3.5" /></div>),
                      header: (_: any, info: any) => {
                        const ts = info?.extraInfo?.timestamp;
                        const model = info?.extraInfo?.model;
                        if (!ts) return null;
                        return <span className="text-[10px] text-zinc-400">{model ? `${model} · ` : ''}{formatTime(ts)}</span>;
                      },
                      contentRender,
                      footer: (content: any, info: any) => {
                        if (!info?.extraInfo?.isLastAi || streaming) return null;
                        const text = typeof content === 'string' ? content : '';
                        return (
                          <div className="flex gap-2 text-[10px]">
                            <button className="text-zinc-400 hover:text-zinc-600" onClick={() => navigator.clipboard.writeText(text)} title="复制">📋 复制</button>
                            <button className="text-zinc-400 hover:text-zinc-600" onClick={handleRegenerate} title="重新生成">↻ 重新生成</button>
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
                        return <span className="text-[10px] text-zinc-400">{formatTime(ts)}</span>;
                      },
                      avatar: (<div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0"><span className="text-xs font-bold">U</span></div>),
                    },
                    tool: { placement: 'start', variant: 'borderless', contentRender },
                  }} />
                {latestComparison.length > 0 && (
                  <div className="grid grid-cols-1 items-start gap-3 px-4 pb-4 lg:grid-cols-2">
                    {latestComparison.map((message) => (
                      <section
                        key={message.id}
                        className="min-w-0 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20"
                      >
                        <div className="mb-2 flex items-center justify-between border-b border-violet-100 pb-2 text-xs dark:border-violet-900">
                          <span className="font-semibold text-violet-700 dark:text-violet-300">
                            {MODELS.find((model) => model.value === message.model)?.label ?? message.model}
                          </span>
                          <button
                            className="text-[10px] text-zinc-400 hover:text-zinc-600"
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            disabled={!message.content}
                          >
                            复制
                          </button>
                        </div>
                        {message.content ? (
                          <XMarkdown content={message.content} streaming={{ hasNextChunk: streaming }} className="text-sm" />
                        ) : (
                          <div className="py-6 text-center text-xs text-zinc-400">
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
                    <p className="text-xs text-red-500">{error}</p>
                    <button className="text-xs text-blue-500 hover:text-blue-600 underline" onClick={handleRetry}>重试</button>
                  </div>
                )}

                {/* Agent 搜索引用源 */}
                {sourcesItems.length > 0 && (
                  <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700">
                    <div className="text-[10px] font-semibold text-zinc-500 mb-1">📚 引用来源</div>
                    <div className="flex flex-wrap gap-1">
                      {sourcesItems.map((s) => (
                        <span key={s.key} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
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
            <div className="border-t shrink-0 bg-zinc-50 dark:bg-zinc-900">
              {attachments.length > 0 && (
                <div className="px-3 pt-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>已添加 {attachments.length} 个文件</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-blue-500 hover:text-blue-600"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        + 添加文件
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
                      <button className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                        onClick={() => fileInputRef.current?.click()} title="选择文件"
                        disabled={!hasKey}>
                        📎
                      </button>
                    </div>
                  }
                  placeholder={!hasKey ? '请先在设置中配置 API Key' : agentMode ? 'Agent 模式：输入任务...' : '输入消息... (Enter 发送)'}
                  style={{ borderRadius: 8 }} />
              </div>
            </div>
          </div>

          <ToolManagerDialog open={toolManagerOpen} onClose={() => setToolManagerOpen(false)} />
          <PromptManagerDialog open={promptManagerOpen} onClose={() => setPromptManagerOpen(false)}
            boundPromptIds={boundPromptIds} onToggleBound={toggleBoundPrompt} />
          <RoleManagerDialog open={roleManagerOpen} onClose={() => setRoleManagerOpen(false)} />
        </div>

        {/* URL 预览弹层 */}
        {previewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewUrl(null)}>
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl overflow-hidden" style={{ width: '90vw', height: '85vh' }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-zinc-50 dark:bg-zinc-800">
                <span className="text-xs text-zinc-500 truncate max-w-[80%]">{previewUrl}</span>
                <div className="flex gap-1">
                  <button className="text-xs text-zinc-400 hover:text-zinc-600 px-2"
                    onClick={() => { const api = (window as any).electronAPI; api?.shell?.openExternal?.(previewUrl); }}>
                    ↗ 浏览器打开
                  </button>
                  <button className="text-xs text-zinc-400 hover:text-red-500 px-2" onClick={() => setPreviewUrl(null)}>✕ 关闭</button>
                </div>
              </div>
              <webview src={previewUrl} style={{ width: '100%', height: 'calc(100% - 37px)' }} />
            </div>
          </div>
        )}
      </XProvider>
    </ConfigProvider>
  );
};
