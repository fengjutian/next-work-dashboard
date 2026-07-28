import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Robot, Copy, Check, Settings, Trash2, RotateCcw, Wrench, Plus, Download, Edit3, ChevronDown } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { createOpenAIProvider, registerTools, runAgent } from '@/core';
import { builtInTools } from '@/core/tools';
import type { ChatMessage, LLMProvider, AgentStep, ToolCall, ToolResult } from '@/core';

let toolsRegistered = false;
if (!toolsRegistered) { registerTools(builtInTools); toolsRegistered = true; }

// ── 模型列表 ──
const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
];

// ── 类型 ──

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  systemPrompt: string;
  createdAt: number;
}

// ── 组件 ──

const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2 rounded-md border bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800">
        <span className="text-[10px] text-zinc-400 uppercase">{lang || 'text'}</span>
        <button className="text-zinc-400 hover:text-zinc-200" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs text-zinc-200 font-mono leading-relaxed"><code>{code}</code></pre>
    </div>
  );
};

const ToolCallCard: React.FC<{ calls: ToolCall[]; results?: ToolResult[] }> = ({ calls, results }) => (
  <div className="my-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
    {calls.map((call) => {
      const result = results?.find((r) => r.callId === call.id);
      return (
        <div key={call.id} className="px-3 py-2 border-b border-amber-200 dark:border-amber-800 last:border-b-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Wrench className="h-3 w-3" /> {call.name}
            {result && !result.error && <Check className="h-3 w-3 text-green-500" />}
          </div>
          <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-500 font-mono">{JSON.stringify(call.arguments)}</div>
          {result && <div className={`mt-1 text-[10px] whitespace-pre-wrap break-all ${result.error ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-400'}`}>{result.error ? `❌ ${result.error}` : result.output}</div>}
        </div>
      );
    })}
  </div>
);

// ── Markdown ──

function renderContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const r = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m.index > last) parts.push(inline(text.slice(last, m.index), `b${last}`));
    parts.push(<CodeBlock key={`c${m.index}`} code={m[2].trimEnd()} lang={m[1] || undefined} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(inline(text.slice(last), `a${last}`));
  return parts.length > 0 ? parts : [<span key="e">{text}</span>];
}

function inline(text: string, key: string): React.ReactNode {
  const segs = text.split(/(`[^`]+`)/g);
  return <span key={key} className="whitespace-pre-wrap break-words">{segs.map((s, i) => {
    if (s.startsWith('`') && s.endsWith('`')) return <code key={i} className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-mono">{s.slice(1, -1)}</code>;
    const bsegs = s.split(/(\*\*[^*]+\*\*)/g);
    return bsegs.map((bs, j) => {
      if (bs.startsWith('**') && bs.endsWith('**')) return <strong key={`${i}${j}`} className="font-semibold">{bs.slice(2, -2)}</strong>;
      const hm = bs.match(/^(#{1,3})\s+(.+)$/m);
      if (hm && !bs.includes('\n')) return <div key={`${i}${j}`} className={`text-${hm[1].length===1?'base':'sm'} font-semibold mt-2 mb-1`}>{hm[2]}</div>;
      return <span key={`${i}${j}`}>{bs}</span>;
    });
  })}</span>;
}

// ── 消息气泡 ──

const MessageBubble: React.FC<{
  msg: Message; onRegenerate?: () => void; canRegenerate: boolean;
  onEdit?: () => void; canEdit: boolean; editing?: boolean;
  editValue?: string; onEditChange?: (v: string) => void; onEditSave?: () => void; onEditCancel?: () => void;
}> = ({ msg, onRegenerate, canRegenerate, onEdit, canEdit, editing, editValue, onEditChange, onEditSave, onEditCancel }) => {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';
  if (!msg.content.trim() && msg.role === 'assistant' && !msg.toolCalls) return null;

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''} mb-4 group`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-blue-500 text-white' : isTool ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>
        {isUser ? <span className="text-xs font-bold">U</span> : isTool ? <Wrench className="h-3.5 w-3.5" /> : <Robot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${isUser ? 'bg-blue-500 text-white' : isTool ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'}`}>
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea className="w-full bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border rounded p-1.5 text-xs resize-none" rows={3} value={editValue} onChange={(e) => onEditChange?.(e.target.value)} autoFocus />
            <div className="flex gap-1 justify-end">
              <button className="text-[10px] px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700" onClick={onEditCancel}>取消</button>
              <button className="text-[10px] px-2 py-0.5 rounded bg-blue-500 text-white" onClick={onEditSave}>保存并重发</button>
            </div>
          </div>
        ) : (
          <>
            {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallCard calls={msg.toolCalls} results={msg.toolResults} />}
            {msg.content && (isUser ? <span className="whitespace-pre-wrap break-words">{msg.content}</span> : renderContent(msg.content))}
          </>
        )}
      </div>
      {/* 操作按钮 */}
      {!isUser && canRegenerate && onRegenerate && !editing && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="重新生成" onClick={onRegenerate}><RotateCcw className="h-3.5 w-3.5" /></button>
      )}
      {isUser && canEdit && onEdit && !editing && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="编辑" onClick={onEdit}><Edit3 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
};

// ── 空状态 ──

const EmptyChat: React.FC<{ hasKey: boolean }> = ({ hasKey }) => (
  <div className="flex-1 flex items-center justify-center">
    <div className="text-center space-y-4 max-w-sm">
      <Robot className="h-10 w-10 text-zinc-300 mx-auto" />
      {hasKey ? <><h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">AI 对话</h3><p className="text-xs text-zinc-400">输入消息开始对话，可开启 Agent 模式自动调用工具</p></>
        : <><h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">未配置 API Key</h3><p className="text-xs text-zinc-400">请在设置 → AI API 中配置后使用</p></>}
    </div>
  </div>
);

// ════════════════════════════════════════
// 主面板
// ════════════════════════════════════════

export const ChatPanel: React.FC = () => {
  const aiApi = useStore((s) => s.aiApi);
  const selectedPromptId = useStore((s) => s.selectedPromptId);
  const prompts = useStore((s) => s.prompts);
  const promptDrawerOpen = useStore((s) => s.promptDrawerOpen);
  const setPromptDrawerOpen = useStore((s) => s.setPromptDrawerOpen);
  const setActiveActivity = useStore((s) => s.setActiveActivity);

  // ── 会话管理 ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');
  const [showHistory, setShowHistory] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages ?? [];
  const systemPrompt = activeSession?.systemPrompt ?? '';

  // 确保至少有一个默认会话
  useEffect(() => {
    if (sessions.length === 0) {
      const def: Session = { id: 'default', title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', createdAt: Date.now() };
      setSessions([def]);
      setActiveSessionId('default');
    }
  }, [sessions.length]);

  // 当前会话的模型
  const currentModel = activeSession?.model ?? aiApi.model;

  // ── 状态 ──
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sysPromptOpen, setSysPromptOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<LLMProvider | null>(null);

  const hasKey = !!aiApi.apiKey;

  useEffect(() => { inputRef.current?.focus(); }, [activeSessionId]);

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
      const p = prompts.find((pp) => pp.id === selectedPromptId);
      if (p && !streaming) { setInput((prev) => (prev ? prev + '\n' + p.content : p.content)); inputRef.current?.focus(); }
    }
  }, [selectedPromptId, promptDrawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 更新会话消息 ──
  const updateSession = useCallback((fn: (msgs: Message[]) => Message[]) => {
    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, messages: fn(s.messages) } : s));
  }, [activeSessionId]);

  const updateSessionMeta = useCallback((patch: Partial<Session>) => {
    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, ...patch } : s));
  }, [activeSessionId]);

  // ── 新建会话 ──
  const handleNewSession = useCallback(() => {
    const id = `s-${Date.now()}`;
    const s: Session = { id, title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', createdAt: Date.now() };
    setSessions((prev) => [...prev, s]);
    setActiveSessionId(id);
    setShowHistory(false);
    setError(null);
  }, [aiApi.model]);

  // ── 删除会话 ──
  const handleDeleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        if (next.length > 0) setActiveSessionId(next[0].id);
        else {
          const def: Session = { id: 'default', title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', createdAt: Date.now() };
          setActiveSessionId('default');
          return [def];
        }
      }
      return next;
    });
  }, [activeSessionId, aiApi.model]);

  // ── 导出对话 ──
  const handleExport = useCallback(() => {
    const md = messages.map((m) => {
      if (m.role === 'user') return `### 🧑 用户\n\n${m.content}\n`;
      if (m.role === 'tool') return `> 🔧 工具: ${m.toolCalls?.map((c) => c.name).join(', ') || ''}\n> ${m.content.replace(/\n/g, '\n> ')}\n`;
      let text = `### 🤖 AI\n\n${m.content}`;
      if (m.toolCalls) text += `\n\n*调用工具: ${m.toolCalls.map((c) => c.name).join(', ')}*`;
      return text + '\n';
    }).join('\n');
    const full = `# ${activeSession?.title || '对话导出'}\n\n> 模型: ${currentModel}\n> 日期: ${new Date().toLocaleString()}\n\n---\n\n${md}`;
    const blob = new Blob([full], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
  }, [messages, currentModel, activeSession]);

  // ── 编辑消息 ──
  const handleStartEdit = useCallback((msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (msg) { setEditValue(msg.content); setEditingMsgId(msgId); }
  }, [messages]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingMsgId || streaming) return;
    const idx = messages.findIndex((m) => m.id === editingMsgId);
    if (idx === -1) return;

    // 截断到编辑位置之前
    const trimmed = messages.slice(0, idx);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: editValue, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...trimmed, userMsg];
    updateSession(() => [...newHistory, assistantMsg]);
    setEditingMsgId(null);
    setStreaming(true);
    setError(null);

    try {
      if (agentMode) {
        await runAgentChat(newHistory, assistantMsg.id, editValue);
      } else {
        await runChat(newHistory, assistantMsg.id);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
        updateSession((prev) => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.id === assistantMsg.id && !last.content) u[u.length - 1] = { ...last, content: `❌ ${err?.message ?? '请求失败'}` };
          return u;
        });
      }
    } finally { setStreaming(false); }
  }, [editingMsgId, streaming, messages, agentMode]);

  // ── Chat / Agent 核心 ──
  const runChat = useCallback(async (history: Message[], assistantId: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');
    const sysMsg = systemPrompt.trim() ? [{ role: 'system' as const, content: systemPrompt }] : [];
    const chatMessages: ChatMessage[] = [...sysMsg, ...history.filter((m) => m.content.trim() && m.role !== 'tool').map((m) => ({ role: m.role as 'user'|'assistant', content: m.content }))];
    let full = '';
    const stream = provider.chat(chatMessages, { model: currentModel });
    for await (const chunk of stream) {
      full += chunk.delta;
      updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, content: full }; return u; });
    }
    updateSession((prev) => { const last = prev[prev.length - 1]; if (last?.id === assistantId && !last.content.trim()) return prev.slice(0, -1); return prev; });
    // 自动标题
    if (history.length <= 1 && full) {
      const title = history[0]?.content?.slice(0, 30) + (history[0]?.content?.length > 30 ? '...' : '') || '新对话';
      updateSessionMeta({ title });
    }
  }, [currentModel, systemPrompt, getProvider]);

  const runAgentChat = useCallback(async (history: Message[], assistantId: string, userContent: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');
    const chatHistory: ChatMessage[] = history.filter((m) => m.content.trim() && m.role !== 'tool').map((m) => ({ role: m.role as 'user'|'assistant', content: m.content }));
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();

    let thinkingText = '';
    let currentToolCalls: ToolCall[] = [];
    for await (const step of runAgent(provider, userContent, chatHistory, currentModel)) {
      switch (step.type) {
        case 'think':
          updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, content: '🤔 思考中...' }; return u; });
          break;
        case 'act':
          thinkingText = step.content || ''; currentToolCalls = step.toolCalls || [];
          updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, content: thinkingText || '🔧 调用工具中...', toolCalls: [...currentToolCalls] }; return u; });
          break;
        case 'observe':
          if (step.toolResults && step.toolResults.length > 0) {
            const toolMsg: Message = { id: `t-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, role: 'tool', content: step.toolResults.map((r) => r.error || r.output || '').join('\n'), timestamp: Date.now(), toolResults: step.toolResults };
            updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, toolResults: step.toolResults, content: thinkingText || '' }; u.push(toolMsg); return u; });
          }
          break;
        case 'answer':
          updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, content: step.content || '', toolCalls: last.toolCalls, toolResults: last.toolResults }; return u; });
          break;
      }
    }
  }, [currentModel, getProvider]);

  // ── 发送 ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput(''); setError(null);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    updateSession(() => [...newHistory, assistantMsg]);
    setStreaming(true);
    try {
      if (agentMode) await runAgentChat(newHistory, assistantMsg.id, text);
      else await runChat(newHistory, assistantMsg.id);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
        updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantMsg.id && !last.content) u[u.length - 1] = { ...last, content: `❌ ${err?.message ?? '请求失败'}` }; return u; });
      }
    } finally { setStreaming(false); }
  }, [input, streaming, messages, agentMode, runChat, runAgentChat]);

  const handleRegenerate = useCallback(async () => {
    if (streaming || messages.length < 2) return;
    setError(null);
    const trimmed = messages.slice(0, -1);
    const lastUser = trimmed[trimmed.length - 1];
    if (lastUser?.role !== 'user') return;
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    updateSession(() => [...trimmed, assistantMsg]);
    setStreaming(true);
    try {
      if (agentMode) await runAgentChat(trimmed, assistantMsg.id, lastUser.content);
      else await runChat(trimmed, assistantMsg.id);
    } catch (err: any) { if (err.name !== 'AbortError') setError(err?.message ?? '请求失败'); }
    finally { setStreaming(false); }
  }, [streaming, messages, agentMode, runChat, runAgentChat]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => { updateSession(() => []); setError(null); }, []);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant');

  return (
    <div className="flex-1 flex h-full bg-white dark:bg-zinc-950">
      {/* 主聊天区 */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* 头部 */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 flex-wrap">
          {/* 新建对话 */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} title="新建对话"><Plus className="h-4 w-4" /></Button>

          {/* 历史记录 */}
          <Button variant="ghost" size="icon" className={`h-7 w-7 ${showHistory ? 'text-blue-500' : ''}`} onClick={() => setShowHistory(!showHistory)} title="对话历史"><ChevronDown className={`h-4 w-4 transition-transform ${showHistory ? 'rotate-180' : ''}`} /></Button>

          <span className="text-xs font-medium text-zinc-500 truncate max-w-[120px]">{activeSession?.title || '新对话'}</span>

          <div className="flex-1" />

          {/* 模型选择器 */}
          <select
            className="h-6 text-[10px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 text-zinc-600 dark:text-zinc-400"
            value={currentModel}
            onChange={(e) => updateSessionMeta({ model: e.target.value })}
          >
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          {/* Agent 开关 */}
          <button className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors ${agentMode ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`} onClick={() => setAgentMode((v) => !v)}>
            {agentMode ? 'Agent ✓' : 'Agent'}
          </button>

          {/* 系统提示词 */}
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-[10px] ${sysPromptOpen || systemPrompt ? 'text-blue-500' : 'text-zinc-400'}`} onClick={() => setSysPromptOpen((v) => !v)} title="系统提示词">Sys</Button>

          <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400" onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}>提示词</Button>
          {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></Button>}
          {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={handleExport} title="导出 Markdown"><Download className="h-3.5 w-3.5" /></Button>}
          {!hasKey && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')}><Settings className="h-3.5 w-3.5" /></Button>}
        </div>

        {/* 系统提示词展开区 */}
        {sysPromptOpen && (
          <div className="px-3 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0">
            <textarea
              className="w-full text-xs bg-white dark:bg-zinc-800 border rounded p-2 resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
              rows={2}
              placeholder="系统提示词 — 定义 AI 的角色和行为方式（如：你是一个专业的前端工程师...）"
              value={systemPrompt}
              onChange={(e) => updateSessionMeta({ systemPrompt: e.target.value })}
            />
          </div>
        )}

        {/* 消息区域 */}
        {messages.length === 0 ? (
          <EmptyChat hasKey={hasKey} />
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.map((msg, i) => {
              const isLastUser = msg.role === 'user' && messages.filter((m) => m.role !== 'tool').reverse()[0]?.id === msg.id;
              const isLastAssistant = msg.role === 'assistant' && messages.filter((m) => m.role !== 'tool').reverse()[0]?.id === msg.id;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  canRegenerate={isLastAssistant && !streaming}
                  onRegenerate={handleRegenerate}
                  canEdit={isLastUser && !streaming}
                  onEdit={() => handleStartEdit(msg.id)}
                  editing={editingMsgId === msg.id}
                  editValue={editValue}
                  onEditChange={setEditValue}
                  onEditSave={handleSaveEdit}
                  onEditCancel={() => setEditingMsgId(null)}
                />
              );
            })}
            {error && <p className="text-xs text-red-500 text-center mb-2">{error}</p>}
          </div>
        )}

        {/* 输入区域 */}
        <div className="border-t p-3 shrink-0 bg-zinc-50 dark:bg-zinc-900">
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={!hasKey ? '请先在设置中配置 API Key' : agentMode ? 'Agent 模式：输入任务...' : '输入消息... (Enter 发送)'}
              disabled={!hasKey} rows={2}
              className="flex-1 resize-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50" />
            {streaming ? (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={handleStop}><span className="text-lg leading-none">■</span></Button>
            ) : (
              <Button size="icon" className={`h-9 w-9 shrink-0 ${agentMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'}`} onClick={handleSend} disabled={!input.trim() || !hasKey}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 历史记录侧边栏 */}
      {showHistory && (
        <div className="w-64 border-l shrink-0 flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold text-zinc-500">对话历史</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHistory(false)}><span className="text-xs">✕</span></Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...sessions].sort((a, b) => b.createdAt - a.createdAt).map((s) => (
              <div key={s.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs border-b border-zinc-100 dark:border-zinc-800 transition-colors ${s.id === activeSessionId ? 'bg-blue-50 dark:bg-blue-950 text-blue-600' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}
                onClick={() => { setActiveSessionId(s.id); setShowHistory(false); }}>
                <span className="flex-1 truncate">{s.title}</span>
                <span className="text-[10px] text-zinc-400">{new Date(s.createdAt).toLocaleDateString()}</span>
                <button className="text-zinc-400 hover:text-red-500 ml-1" onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
