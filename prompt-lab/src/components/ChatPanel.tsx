import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Robot, Copy, Check, Settings, Trash2, RotateCcw, Wrench } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { createOpenAIProvider, registerTools, runAgent } from '@/core';
import { builtInTools } from '@/core/tools';
import type { ChatMessage, LLMProvider, AgentStep, ToolCall, ToolResult } from '@/core';

// 注册内置工具（模块加载时一次性）
let toolsRegistered = false;
if (!toolsRegistered) { registerTools(builtInTools); toolsRegistered = true; }

// ── 类型 ──

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  /** Agent 模式下的工具调用 */
  toolCalls?: ToolCall[];
  /** Agent 模式下的工具结果 */
  toolResults?: ToolResult[];
}

// ── 代码块 ──

const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2 rounded-md border bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800">
        <span className="text-[10px] text-zinc-400 uppercase">{lang || 'text'}</span>
        <button className="text-zinc-400 hover:text-zinc-200 transition-colors"
          onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs text-zinc-200 font-mono leading-relaxed"><code>{code}</code></pre>
    </div>
  );
};

// ── 工具调用卡片 ──

const ToolCallCard: React.FC<{ calls: ToolCall[]; results?: ToolResult[] }> = ({ calls, results }) => {
  const expanded = calls.length <= 2; // 少于 2 个自动展开
  return (
    <div className="my-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
      {calls.map((call) => {
        const result = results?.find((r) => r.callId === call.id);
        return (
          <div key={call.id} className="px-3 py-2 border-b border-amber-200 dark:border-amber-800 last:border-b-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Wrench className="h-3 w-3" />
              {call.name}
              {result && !result.error && <Check className="h-3 w-3 text-green-500" />}
            </div>
            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-500 font-mono">
              {JSON.stringify(call.arguments)}
            </div>
            {result && (
              <div className={`mt-1 text-[10px] whitespace-pre-wrap break-all ${result.error ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-400'}`}>
                {result.error ? `❌ ${result.error}` : result.output}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Markdown 渲染 ──

function renderContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0, match: RegExpExecArray | null;
  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(renderInline(text.slice(lastIndex, match.index), `before-${lastIndex}`));
    parts.push(<CodeBlock key={`code-${match.index}`} code={match[2].trimEnd()} lang={match[1] || undefined} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(renderInline(text.slice(lastIndex), `after-${lastIndex}`));
  return parts.length > 0 ? parts : [<span key="empty">{text}</span>];
}

function renderInline(text: string, key: string): React.ReactNode {
  const codeSegs = text.split(/(`[^`]+`)/g);
  return (
    <span key={key} className="whitespace-pre-wrap break-words">
      {codeSegs.map((seg, i) => {
        if (seg.startsWith('`') && seg.endsWith('`'))
          return <code key={i} className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-mono">{seg.slice(1, -1)}</code>;
        const boldSegs = seg.split(/(\*\*[^*]+\*\*)/g);
        return boldSegs.map((bseg, j) => {
          if (bseg.startsWith('**') && bseg.endsWith('**'))
            return <strong key={`${i}-${j}`} className="font-semibold">{bseg.slice(2, -2)}</strong>;
          const hm = bseg.match(/^(#{1,3})\s+(.+)$/m);
          if (hm && !bseg.includes('\n'))
            return <div key={`${i}-${j}`} className={`text-${hm[1].length === 1 ? 'base' : 'sm'} font-semibold mt-2 mb-1`}>{hm[2]}</div>;
          return <span key={`${i}-${j}`}>{bseg}</span>;
        });
      })}
    </span>
  );
}

// ── 消息气泡 ──

const MessageBubble: React.FC<{ msg: Message; onRegenerate?: () => void; canRegenerate: boolean }> = ({ msg, onRegenerate, canRegenerate }) => {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';
  if (!msg.content.trim() && msg.role === 'assistant' && !msg.toolCalls) return null;

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''} mb-4 group`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        isUser ? 'bg-blue-500 text-white' : isTool ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>
        {isUser ? <span className="text-xs font-bold">U</span> : isTool ? <Wrench className="h-3.5 w-3.5" /> : <Robot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
        isUser ? 'bg-blue-500 text-white' : isTool ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'}`}>
        {/* 工具调用卡片 */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallCard calls={msg.toolCalls} results={msg.toolResults} />
        )}
        {/* 文本内容 */}
        {msg.content && (isUser ? <span className="whitespace-pre-wrap break-words">{msg.content}</span> : renderContent(msg.content))}
      </div>
      {!isUser && canRegenerate && onRegenerate && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="重新生成" onClick={onRegenerate}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

// ── 空状态 ──

const EmptyChat: React.FC<{ hasApiKey: boolean }> = ({ hasApiKey }) => (
  <div className="flex-1 flex items-center justify-center">
    <div className="text-center space-y-4 max-w-sm">
      <Robot className="h-10 w-10 text-zinc-300 mx-auto" />
      {hasApiKey ? (
        <>
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">AI 对话</h3>
          <p className="text-xs text-zinc-400">在下方输入消息，开启 Agent 模式可自动调用工具</p>
        </>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">未配置 API Key</h3>
          <p className="text-xs text-zinc-400">请在设置 → AI API 中配置 DeepSeek API Key 后使用</p>
        </>
      )}
    </div>
  </div>
);

// ── 主面板 ──

export const ChatPanel: React.FC = () => {
  const aiApi = useStore((s) => s.aiApi);
  const selectedPromptId = useStore((s) => s.selectedPromptId);
  const prompts = useStore((s) => s.prompts);
  const promptDrawerOpen = useStore((s) => s.promptDrawerOpen);
  const setPromptDrawerOpen = useStore((s) => s.setPromptDrawerOpen);
  const setActiveActivity = useStore((s) => s.setActiveActivity);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<LLMProvider | null>(null);

  const hasKey = !!aiApi.apiKey;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const getProvider = useCallback((): LLMProvider | null => {
    if (!aiApi.apiKey) return null;
    if (providerRef.current) return providerRef.current;
    providerRef.current = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
    return providerRef.current;
  }, [aiApi.apiKey, aiApi.baseUrl]);

  useEffect(() => { providerRef.current = null; }, [aiApi.apiKey, aiApi.baseUrl]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  useEffect(() => {
    if (selectedPromptId && promptDrawerOpen === false) {
      const prompt = prompts.find((p) => p.id === selectedPromptId);
      if (prompt && !streaming) { setInput((prev) => (prev ? prev + '\n' + prompt.content : prompt.content)); inputRef.current?.focus(); }
    }
  }, [selectedPromptId, promptDrawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 普通 Chat 模式 */
  const runChat = useCallback(async (history: Message[], assistantId: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');

    const chatMessages: ChatMessage[] = history
      .filter((m) => m.content.trim() && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let full = '';
    const stream = provider.chat(chatMessages, { model: aiApi.model });
    for await (const chunk of stream) {
      full += chunk.delta;
      setMessages((prev) => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last?.id === assistantId) u[u.length - 1] = { ...last, content: full };
        return u;
      });
    }
    // 清理空内容
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.id === assistantId && !last.content.trim()) return prev.slice(0, -1);
      return prev;
    });
  }, [aiApi.model, getProvider]);

  /** Agent 模式 */
  const runAgentChat = useCallback(async (history: Message[], assistantId: string, userContent: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');

    const chatHistory: ChatMessage[] = history
      .filter((m) => m.content.trim() && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    // 去掉最后一条 user 消息（runAgent 会自己加）
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();

    let thinkingText = '';
    let currentToolCalls: ToolCall[] = [];
    let finalContent = '';

    for await (const step of runAgent(provider, userContent, chatHistory, aiApi.model)) {
      switch (step.type) {
        case 'think':
          // 开始思考 — 更新 assistant 消息为 "思考中..."
          setMessages((prev) => {
            const u = [...prev];
            const last = u[u.length - 1];
            if (last?.id === assistantId) u[u.length - 1] = { ...last, content: '🤔 思考中...' };
            return u;
          });
          break;

        case 'act':
          // 工具调用 — 保存 thinking 文本 + tool calls
          thinkingText = step.content || '';
          currentToolCalls = step.toolCalls || [];
          setMessages((prev) => {
            const u = [...prev];
            const last = u[u.length - 1];
            if (last?.id === assistantId) {
              u[u.length - 1] = {
                ...last,
                content: thinkingText || '🔧 调用工具中...',
                toolCalls: [...currentToolCalls],
              };
            }
            return u;
          });
          break;

        case 'observe':
          // 工具结果返回 — 追加 tool 消息
          if (step.toolResults && step.toolResults.length > 0) {
            const toolMsg: Message = {
              id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'tool',
              content: step.toolResults.map((r) => r.error || r.output || '').join('\n'),
              timestamp: Date.now(),
              toolResults: step.toolResults,
            };
            setMessages((prev) => {
              const u = [...prev];
              const last = u[u.length - 1];
              // 更新 assistant 消息的 toolResults
              if (last?.id === assistantId) {
                u[u.length - 1] = { ...last, toolResults: step.toolResults, content: thinkingText || '' };
              }
              u.push(toolMsg);
              return u;
            });
          }
          break;

        case 'answer':
          // 最终答案
          finalContent = step.content || '';
          setMessages((prev) => {
            const u = [...prev];
            const last = u[u.length - 1];
            if (last?.id === assistantId) {
              u[u.length - 1] = {
                ...last,
                content: finalContent,
                // 保留已有的 toolCalls/toolResults
                toolCalls: last.toolCalls,
                toolResults: last.toolResults,
              };
            }
            return u;
          });
          break;
      }
    }
  }, [aiApi.model, getProvider]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput(''); setError(null);

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    setMessages([...newHistory, assistantMsg]);
    setStreaming(true);

    try {
      if (agentMode) {
        await runAgentChat(newHistory, assistantMsg.id, text);
      } else {
        await runChat(newHistory, assistantMsg.id);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
        setMessages((prev) => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.id === assistantMsg.id && !last.content) u[u.length - 1] = { ...last, content: `❌ ${err?.message ?? '请求失败'}` };
          return u;
        });
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, messages, agentMode, runChat, runAgentChat]);

  const handleRegenerate = useCallback(async () => {
    if (streaming || messages.length < 2) return;
    setError(null);
    const trimmed = messages.slice(0, -1);
    const lastUser = trimmed[trimmed.length - 1];
    if (lastUser?.role !== 'user') return;

    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    setMessages([...trimmed, assistantMsg]);
    setStreaming(true);

    try {
      if (agentMode) {
        await runAgentChat(trimmed, assistantMsg.id, lastUser.content);
      } else {
        await runChat(trimmed, assistantMsg.id);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err?.message ?? '请求失败');
    } finally {
      setStreaming(false);
    }
  }, [streaming, messages, agentMode, runChat, runAgentChat]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => { setMessages([]); setError(null); }, []);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Robot className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI 对话</span>
          {streaming && <span className="text-[10px] text-zinc-400 animate-pulse">{agentMode ? 'Agent 思考中...' : '生成中...'}</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* Agent 模式开关 */}
          <button
            className={`h-6 px-2 text-[10px] font-medium rounded-full transition-colors ${
              agentMode
                ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600'
            }`}
            onClick={() => setAgentMode((v) => !v)}
            title={agentMode ? 'Agent 模式：自动调用工具' : '普通对话模式'}
          >
            {agentMode ? 'Agent ✓' : 'Agent'}
          </button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400 hover:text-zinc-600" onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}>提示词</Button>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
          {!hasKey && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')} title="配置 API Key"><Settings className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      {messages.length === 0 ? (
        <EmptyChat hasApiKey={hasKey} />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              canRegenerate={msg.role === 'assistant' && i === messages.filter((m) => m.role !== 'tool').length - 1 && !streaming}
              onRegenerate={handleRegenerate}
            />
          ))}
          {error && <p className="text-xs text-red-500 text-center mb-2">{error}</p>}
        </div>
      )}

      {/* 输入区域 */}
      <div className="border-t p-3 shrink-0 bg-zinc-50 dark:bg-zinc-900">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={!hasKey ? '请先在设置中配置 API Key' : agentMode ? 'Agent 模式：输入任务，AI 自动调用工具...' : '输入消息... (Enter 发送)'}
            disabled={!hasKey}
            rows={2}
            className="flex-1 resize-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          />
          {streaming ? (
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={handleStop} title="停止生成">
              <span className="text-lg leading-none">■</span>
            </Button>
          ) : (
            <Button size="icon" className={`h-9 w-9 shrink-0 ${agentMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
              onClick={handleSend} disabled={!input.trim() || !hasKey} title={agentMode ? '启动 Agent' : '发送'}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
