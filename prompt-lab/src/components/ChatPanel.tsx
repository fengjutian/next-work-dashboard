import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Robot, Copy, Check, Settings, Trash2, RotateCcw } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { createOpenAIProvider } from '@/core';
import type { ChatMessage, LLMProvider } from '@/core';

// ── 类型 ──

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ── 简易 Markdown 渲染 ──

const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2 rounded-md border bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800">
        <span className="text-[10px] text-zinc-400 uppercase">{lang || 'text'}</span>
        <button
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
          onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          title="复制"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs text-zinc-200 font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

/** 简单 Markdown：代码块 + 标题 + 粗体 + 内联代码 */
function renderContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderInline(text.slice(lastIndex, match.index), `before-${lastIndex}`));
    }
    parts.push(<CodeBlock key={`code-${match.index}`} code={match[2].trimEnd()} lang={match[1] || undefined} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(renderInline(text.slice(lastIndex), `after-${lastIndex}`));
  }
  return parts.length > 0 ? parts : [<span key="empty">{text}</span>];
}

/** 内联：code + bold + headings */
function renderInline(text: string, key: string): React.ReactNode {
  // 先按 `` 分割，再对非 code 部分处理 bold/heading
  const codeSegs = text.split(/(`[^`]+`)/g);
  return (
    <span key={key} className="whitespace-pre-wrap break-words">
      {codeSegs.map((seg, i) => {
        if (seg.startsWith('`') && seg.endsWith('`')) {
          return <code key={i} className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-mono">{seg.slice(1, -1)}</code>;
        }
        // 处理 bold **text**
        const boldSegs = seg.split(/(\*\*[^*]+\*\*)/g);
        return boldSegs.map((bseg, j) => {
          if (bseg.startsWith('**') && bseg.endsWith('**')) {
            return <strong key={`${i}-${j}`} className="font-semibold">{bseg.slice(2, -2)}</strong>;
          }
          // 处理 ### heading
          const headingMatch = bseg.match(/^(#{1,3})\s+(.+)$/m);
          if (headingMatch && bseg.indexOf('\n') === -1) {
            const level = headingMatch[1].length;
            const size = level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-xs';
            return <div key={`${i}-${j}`} className={`${size} font-semibold mt-2 mb-1`}>{headingMatch[2]}</div>;
          }
          return <span key={`${i}-${j}`}>{bseg}</span>;
        });
      })}
    </span>
  );
}

// ── 消息气泡 ──

const MessageBubble: React.FC<{ msg: Message; onRegenerate?: () => void; canRegenerate: boolean }> = ({ msg, onRegenerate, canRegenerate }) => {
  const isUser = msg.role === 'user';
  const isEmpty = !msg.content.trim();
  if (isEmpty && msg.role === 'assistant') return null; // 跳空空 AI 消息
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''} mb-4 group`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'}`}>
        {isUser ? <span className="text-xs font-bold">U</span> : <Robot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${isUser ? 'bg-blue-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'}`}>
        {isUser ? <span className="whitespace-pre-wrap break-words">{msg.content}</span> : renderContent(msg.content)}
      </div>
      {/* 最后一条 AI 消息显示重试按钮 */}
      {!isUser && canRegenerate && onRegenerate && (
        <button
          className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
          title="重新生成"
          onClick={onRegenerate}
        >
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
          <p className="text-xs text-zinc-400">在下方输入消息，开始与 AI 对话</p>
          <p className="text-[10px] text-zinc-400">提示：可从提示词面板选择模板填入</p>
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
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<LLMProvider | null>(null);

  const hasKey = !!aiApi.apiKey;

  // 面板挂载时自动聚焦
  useEffect(() => { inputRef.current?.focus(); }, []);

  // 懒初始化 provider
  const getProvider = useCallback((): LLMProvider | null => {
    if (!aiApi.apiKey) return null;
    if (providerRef.current) return providerRef.current;
    providerRef.current = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
    return providerRef.current;
  }, [aiApi.apiKey, aiApi.baseUrl]);

  // API Key 变更时重置
  useEffect(() => { providerRef.current = null; }, [aiApi.apiKey, aiApi.baseUrl]);

  // 自动滚底
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 从 PromptDrawer 选择模板后填入
  useEffect(() => {
    if (selectedPromptId && promptDrawerOpen === false) {
      const prompt = prompts.find((p) => p.id === selectedPromptId);
      if (prompt && !streaming) {
        setInput((prev) => (prev ? prev + '\n' + prompt.content : prompt.content));
        inputRef.current?.focus();
      }
    }
  }, [selectedPromptId, promptDrawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 核心：发送消息（与 regenerate 共用） */
  const runChat = useCallback(async (userContent: string, history: Message[], onChunk: (text: string) => void) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先在设置中配置 API Key');

    const abort = new AbortController();
    abortRef.current = abort;

    const chatMessages: ChatMessage[] = history
      .filter((m) => m.content.trim()) // 过滤空消息
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let fullContent = '';
    try {
      const stream = provider.chat(chatMessages, { model: aiApi.model, signal: abort.signal });
      for await (const chunk of stream) {
        fullContent += chunk.delta;
        onChunk(fullContent);
      }
    } finally {
      abortRef.current = null;
    }
    return fullContent;
  }, [aiApi.model, getProvider]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setError(null);

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    setMessages([...newHistory, assistantMsg]);
    setStreaming(true);

    try {
      await runChat(text, newHistory, (fullContent) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.id === assistantMsg.id) updated[updated.length - 1] = { ...last, content: fullContent };
          return updated;
        });
      });
      // 流结束清理空内容
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.id === assistantMsg.id && !last.content.trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const msg = err?.message ?? '请求失败';
        setError(msg);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.id === assistantMsg.id && !last.content) {
            updated[updated.length - 1] = { ...last, content: `❌ ${msg}` };
          }
          return updated;
        });
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, messages, runChat]);

  /** 重新生成最后一条 AI 回复 */
  const handleRegenerate = useCallback(async () => {
    if (streaming || messages.length < 2) return;
    setError(null);

    // 移除最后一条 assistant 消息
    const trimmed = messages.slice(0, -1);
    const lastUser = trimmed[trimmed.length - 1];
    if (lastUser?.role !== 'user') return;

    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    setMessages([...trimmed, assistantMsg]);
    setStreaming(true);

    try {
      await runChat(lastUser.content, trimmed, (fullContent) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.id === assistantMsg.id) updated[updated.length - 1] = { ...last, content: fullContent };
          return updated;
        });
      });
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.id === assistantMsg.id && !last.content.trim()) return prev.slice(0, -1);
        return prev;
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
      }
    } finally {
      setStreaming(false);
    }
  }, [streaming, messages, runChat]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => { setMessages([]); setError(null); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant');

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Robot className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI 对话</span>
          {streaming && <span className="text-[10px] text-zinc-400 animate-pulse ml-1">生成中...</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400 hover:text-zinc-600" onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}>提示词</Button>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {!hasKey && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')} title="配置 API Key">
              <Settings className="h-3.5 w-3.5" />
            </Button>
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
              canRegenerate={msg.role === 'assistant' && i === messages.length - 1 && !streaming}
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
            placeholder={hasKey ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '请先在设置中配置 API Key'}
            disabled={!hasKey}
            rows={2}
            className="flex-1 resize-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          />
          {streaming ? (
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={handleStop} title="停止生成">
              <span className="text-lg leading-none">■</span>
            </Button>
          ) : (
            <Button size="icon" className="h-9 w-9 shrink-0 bg-emerald-500 hover:bg-emerald-600" onClick={handleSend} disabled={!input.trim() || !hasKey} title="发送">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
