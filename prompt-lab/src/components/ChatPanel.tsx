import React, { useState, useEffect, useMemo } from 'react';
import { Bubble, Sender, Conversations, Welcome, Prompts, ThoughtChain, Suggestion } from '@ant-design/x';
import { XProvider } from '@ant-design/x';
import type { BubbleProps } from '@ant-design/x';
import { ConfigProvider, theme as antTheme } from 'antd';
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

// ════════════════════════════════════════
// 主面板
// ════════════════════════════════════════

export const ChatPanel: React.FC = () => {
  const setActiveActivity = useStore((s) => s.setActiveActivity);
  const theme = useStore((s) => s.theme);
  const [toolManagerOpen, setToolManagerOpen] = useState(false);
  const [promptManagerOpen, setPromptManagerOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);

  const {
    sessions, activeSessionId, setActiveSessionId, showHistory, setShowHistory,
    messages, systemPrompt, currentModel, hasKey,
    input, setInput, streaming, agentMode, setAgentMode, error,
    sysPromptOpen, setSysPromptOpen,
    handleNewSession, handleDeleteSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear,
    handleEditConfirm,
    updateSessionMeta,
    boundPromptIds, toggleBoundPrompt,
  } = useChatSession();

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // ── 暗色模式 ──
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // ── 角色 Agent ──
  const roles = useStore((s) => s.roles);
  const activeRoleId = useStore((s) => s.activeRoleId);
  const activeRole = roles.find((r) => r.id === activeRoleId);

  useEffect(() => {
    if (activeRole) {
      updateSessionMeta({ systemPrompt: activeRole.systemPrompt });
      const tools = activeRole.enabledToolIds;
      if (tools.length > 0) {
        ALL_TOOLS.forEach((t) => setToolEnabled(t, tools.includes(t)));
      } else {
        ALL_TOOLS.forEach((t) => setToolEnabled(t, true));
      }
    } else {
      ALL_TOOLS.forEach((t) => setToolEnabled(t, true));
    }
  }, [activeRoleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 转换消息为 Bubble.List items ──
  const bubbleItems = useMemo(
    () => toBubbleItems(messages, streaming, error),
    [messages, streaming, error],
  );

  // ── 转换会话为 Conversations items ──
  const conversationItems = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({
          key: s.id,
          label: s.title,
          group: stableDate(s.createdAt),
        })),
    [sessions],
  );

  // ── Sender 提交 ──
  const onSenderSubmit = (text: string) => {
    setInput('');
    handleSend(text);
  };

  // ── 提示词/Suggestion 点击 ──
  const onPromptClick = (info: { data: { key: string; label: string; value: string } }) => {
    handleSend(info.data.value);
  };

  // ── 是否显示 Suggestion（最后一条消息是 AI 且非流式） ──
  const showSuggestion = useMemo(() => {
    if (streaming || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return last?.role === 'assistant' && last.content.trim().length > 0;
  }, [messages, streaming]);

  // ── ThoughtChain 数据 ──
  const thoughtChainItems = useMemo(() => {
    if (!agentMode || messages.length === 0) return [];
    return messages
      .filter((m) => m.role === 'tool' || (m.role === 'assistant' && m.toolCalls?.length))
      .map((m) => {
        if (m.role === 'tool') {
          const results = m.toolResults?.map((r) => r.error || r.output || '').join(', ') || '';
          return {
            title: '🔧 工具结果',
            description: results.slice(0, 120) + (results.length > 120 ? '...' : ''),
            status: 'success' as const,
          };
        }
        return {
          title: '🤔 思考',
          description: m.content?.slice(0, 120) || '调用工具中...',
          status: 'success' as const,
        };
      });
  }, [agentMode, messages]);

  // ── 自定义消息渲染（使用 x-markdown） ──
  const contentRender: BubbleProps['contentRender'] = (content, info) => {
    const extra = (info as any)?.extraInfo;
    const origRole = extra?.originalRole as string | undefined;
    const toolCalls = extra?.toolCalls;
    const toolResults = extra?.toolResults;
    const text = typeof content === 'string' ? content : String(content ?? '');

    // 工具消息 — 琥珀色卡片
    if (origRole === 'tool') {
      return (
        <div className="my-1 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Wrench className="h-3 w-3" /> 工具结果
          </div>
          <div className="mt-1 text-xs whitespace-pre-wrap break-all text-amber-600 dark:text-amber-500">
            {text}
          </div>
        </div>
      );
    }

    // AI 消息 — 工具调用 + x-markdown 渲染
    if (origRole === 'assistant') {
      return (
        <div>
          {toolCalls && toolCalls.length > 0 && (
            <ToolCallCard calls={toolCalls} results={toolResults} />
          )}
          {text && (
            <XMarkdown
              content={text}
              streaming={{ hasNextChunk: streaming }}
              className="text-sm"
            />
          )}
        </div>
      );
    }

    // 用户消息 — 纯文本
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  };

  // ── 判断是否需要显示系统提示词 ──
  const showSysPrompt = sysPromptOpen || (!!systemPrompt && messages.length === 0);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      }}
    >
      <XProvider>
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
                <Conversations
                  items={conversationItems}
                  activeKey={activeSessionId}
                  onActiveChange={(key) => {
                    setActiveSessionId(key);
                    setShowHistory(false);
                  }}
                  menu={(conv) => ({
                    items: [
                      { label: '删除', key: 'delete', danger: true },
                    ],
                    onClick: (info) => {
                      if (info.key === 'delete') {
                        handleDeleteSession(conv.key);
                      }
                    },
                  })}
                  groupable
                  creation={{
                    onClick: handleNewSession,
                  }}
                />
              </div>
            </div>
          )}

          {/* 主聊天区 */}
          <div className="flex-1 flex flex-col h-full min-w-0">
            {/* 头部工具栏 */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 flex-wrap">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} title="新建对话">
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${showHistory ? 'text-blue-500' : ''}`}
                onClick={() => setShowHistory(!showHistory)}
                title="对话历史"
              >
                {showHistory ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Button>
              <span className="text-xs font-medium text-zinc-500 truncate max-w-[120px]">
                {activeSession?.title || '新对话'}
              </span>
              <div className="flex-1" />

              <select
                className="h-6 text-[10px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 text-zinc-600 dark:text-zinc-400"
                value={currentModel}
                onChange={(e) => updateSessionMeta({ model: e.target.value })}
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <button
                className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors ${
                  agentMode
                    ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                }`}
                onClick={() => setAgentMode((v) => !v)}
              >
                {agentMode ? 'Agent ✓' : 'Agent'}
              </button>

              <button
                onClick={() => setRoleManagerOpen(true)}
                className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors flex items-center gap-1 ${
                  activeRole
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600'
                }`}
                title="角色管理"
              >
                <Bot className="h-3 w-3" />
                <span>{activeRole ? activeRole.name : '角色'}</span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setToolManagerOpen(true)}
                title="工具管理"
              >
                <Wrench className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 text-[10px] ${sysPromptOpen || systemPrompt ? 'text-blue-500' : 'text-zinc-400'}`}
                onClick={() => setSysPromptOpen((v) => !v)}
                title="系统提示词"
              >
                Sys
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setPromptManagerOpen(true)}
                title="提示词管理"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={handleExport} title="导出 Markdown">
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
              {!hasKey && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')}>
                  <span className="text-xs">⚙</span>
                </Button>
              )}
            </div>

            {/* 系统提示词 */}
            {showSysPrompt && (
              <div className="px-3 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0">
                <textarea
                  className="w-full text-xs bg-white dark:bg-zinc-800 border rounded p-2 resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
                  rows={2}
                  placeholder="系统提示词 — 定义 AI 的角色和行为方式..."
                  value={systemPrompt}
                  onChange={(e) => updateSessionMeta({ systemPrompt: e.target.value })}
                />
              </div>
            )}

            {/* Agent 思考链 */}
            {agentMode && thoughtChainItems.length > 0 && (
              <div className="px-4 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0 max-h-32 overflow-y-auto">
                <ThoughtChain items={thoughtChainItems as any} />
              </div>
            )}

            {/* 消息区域 */}
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <Welcome
                  variant="borderless"
                  icon={<Robot className="h-10 w-10 text-zinc-300" />}
                  title={hasKey ? 'AI 对话' : '未配置 API Key'}
                  description={
                    hasKey
                      ? '输入消息开始对话，可开启 Agent 模式自动调用工具'
                      : '请在设置 → AI API 中配置后使用'
                  }
                />
                {hasKey && (
                  <Prompts
                    items={WELCOME_PROMPTS}
                    onItemClick={onPromptClick}
                    styles={{ list: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } }}
                  />
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto" style={{ height: 0 }}>
                <Bubble.List
                  items={bubbleItems as any}
                  autoScroll
                  style={{ height: '100%' }}
                  role={{
                    ai: {
                      placement: 'start',
                      variant: 'outlined',
                      typing: streaming
                        ? { effect: 'typing' as const, step: 3, interval: 50 }
                        : false,
                      avatar: (
                        <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                          <Robot className="h-3.5 w-3.5" />
                        </div>
                      ),
                      contentRender,
                      footer: (_: any, info: any) => {
                        if (info?.extraInfo?.isLastAi && !streaming) {
                          return (
                            <button
                              className="text-[10px] text-zinc-400 hover:text-zinc-600 px-1"
                              onClick={handleRegenerate}
                              title="重新生成"
                            >
                              ↻ 重新生成
                            </button>
                          );
                        }
                        return null;
                      },
                    },
                    user: {
                      placement: 'end',
                      variant: 'filled',
                      contentRender,
                      onEditConfirm: handleEditConfirm,
                      avatar: (
                        <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold">U</span>
                        </div>
                      ),
                    },
                    tool: {
                      placement: 'start',
                      variant: 'borderless',
                      contentRender,
                    },
                  }}
                />
                {error && <p className="text-xs text-red-500 text-center py-2">{error}</p>}

                {/* Suggestion 快捷回复 — 最后一条 AI 消息后显示 */}
                {showSuggestion && (
                  <div className="px-4 pb-3">
                    <Suggestion
                      items={SUGGESTION_ITEMS}
                      onSelect={(value) => {
                        handleSend(value);
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 输入区域 */}
            <div className="border-t p-3 shrink-0 bg-zinc-50 dark:bg-zinc-900">
              <Sender
                value={input}
                onChange={setInput}
                onSubmit={onSenderSubmit}
                onCancel={handleStop}
                loading={streaming}
                disabled={!hasKey}
                placeholder={
                  !hasKey
                    ? '请先在设置中配置 API Key'
                    : agentMode
                      ? 'Agent 模式：输入任务...'
                      : '输入消息... (Enter 发送)'
                }
                style={{ borderRadius: 8 }}
              />
            </div>
          </div>

          {/* 弹层 */}
          <ToolManagerDialog open={toolManagerOpen} onClose={() => setToolManagerOpen(false)} />
          <PromptManagerDialog
            open={promptManagerOpen}
            onClose={() => setPromptManagerOpen(false)}
            boundPromptIds={boundPromptIds}
            onToggleBound={toggleBoundPrompt}
          />
          <RoleManagerDialog open={roleManagerOpen} onClose={() => setRoleManagerOpen(false)} />
        </div>
      </XProvider>
    </ConfigProvider>
  );
};
