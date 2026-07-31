import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/store';
import { createOpenAIProvider, registerTools, runAgent } from '@/core';
import { builtInTools } from '@/core/tools';
import { pluginTools } from '@/core/tools/plugin-tools';
import type { ChatMessage, LLMProvider, ToolCall, ToolResult } from '@/core';
import type { Message } from './MessageBubble';
import type { Prompt } from '@/store/types';

// ── 一次性工具注册 ──
let toolsRegistered = false;
if (!toolsRegistered) { registerTools(builtInTools); registerTools(pluginTools); toolsRegistered = true; }

// ── 模型列表 ──
export const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
];

// ── 会话类型 ──
export interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  systemPrompt: string;
  /** 绑定到该会话的提示词 ID 列表 — 自动合并到 systemPrompt */
  boundPromptIds: string[];
  createdAt: number;
}

// ── Hook ──
export function useChatSession() {
  const aiApi = useStore((s) => s.aiApi);
  const selectedPromptId = useStore((s) => s.selectedPromptId);
  const prompts = useStore((s) => s.prompts);
  const promptDrawerOpen = useStore((s) => s.promptDrawerOpen);

  // ── 会话管理 ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages ?? [];
  const systemPrompt = activeSession?.systemPrompt ?? '';

  // 确保至少有一个默认会话
  useEffect(() => {
    if (sessions.length === 0) {
      const def: Session = { id: 'default', title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', boundPromptIds: [], createdAt: Date.now() };
      setSessions([def]);
      setActiveSessionId('default');
    }
  }, [sessions.length, aiApi.model]);

  const currentModel = activeSession?.model ?? aiApi.model;
  const hasKey = !!aiApi.apiKey;

  // ── 状态 ──
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sysPromptOpen, setSysPromptOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<LLMProvider | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, [activeSessionId]);

  const getProvider = useCallback((): LLMProvider | null => {
    if (!aiApi.apiKey) return null;
    if (providerRef.current) return providerRef.current;
    providerRef.current = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
    return providerRef.current;
  }, [aiApi.apiKey, aiApi.baseUrl]);

  useEffect(() => { providerRef.current = null; }, [aiApi.apiKey, aiApi.baseUrl]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  // 提示词注入（仅启用状态的提示词）
  useEffect(() => {
    if (selectedPromptId && promptDrawerOpen === false) {
      const p = prompts.find((pp) => pp.id === selectedPromptId);
      if (p && p.enabled !== false && !streaming) { setInput((prev) => (prev ? prev + '\n' + p.content : p.content)); inputRef.current?.focus(); }
    }
  }, [selectedPromptId, promptDrawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 更新会话 ──
  const updateSession = useCallback((fn: (msgs: Message[]) => Message[]) => {
    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, messages: fn(s.messages) } : s));
  }, [activeSessionId]);

  const updateSessionMeta = useCallback((patch: Partial<Session>) => {
    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, ...patch } : s));
  }, [activeSessionId]);

  // ── 绑定提示词 ──
  const boundPromptIds = activeSession?.boundPromptIds ?? [];

  /** 切换提示词是否绑定到当前对话 */
  const toggleBoundPrompt = useCallback((promptId: string) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeSessionId) return s;
      const ids = s.boundPromptIds ?? [];
      const next = ids.includes(promptId)
        ? ids.filter((id) => id !== promptId)
        : [...ids, promptId];
      return { ...s, boundPromptIds: next };
    }));
  }, [activeSessionId]);

  /** 获取所有绑定提示词的合并内容 */
  const getBoundPromptsContent = useCallback((): string => {
    const ids = activeSession?.boundPromptIds ?? [];
    if (ids.length === 0) return '';
    return ids
      .map((id) => prompts.find((p) => p.id === id))
      .filter((p): p is Prompt => p !== undefined && p.enabled !== false)
      .map((p) => `[${p.title}]\n${p.content}`)
      .join('\n\n');
  }, [activeSession, prompts]);

  // ── 新建/删除/导出会话 ──
  const handleNewSession = useCallback(() => {
    const id = `s-${Date.now()}`;
    const s: Session = { id, title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', boundPromptIds: [], createdAt: Date.now() };
    setSessions((prev) => [...prev, s]);
    setActiveSessionId(id);
    setShowHistory(false);
    setError(null);
  }, [aiApi.model]);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        if (next.length > 0) setActiveSessionId(next[0].id);
        else {
          const def: Session = { id: 'default', title: '新对话', messages: [], model: aiApi.model, systemPrompt: '', boundPromptIds: [], createdAt: Date.now() };
          setActiveSessionId('default');
          return [def];
        }
      }
      return next;
    });
  }, [activeSessionId, aiApi.model]);

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

  // ── Chat / Agent 核心 ──
  const runChat = useCallback(async (history: Message[], assistantId: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');
    const boundContent = getBoundPromptsContent();
    const fullSystemPrompt = [systemPrompt.trim(), boundContent].filter(Boolean).join('\n\n');
    const sysMsg = fullSystemPrompt ? [{ role: 'system' as const, content: fullSystemPrompt }] : [];
    const chatMessages: ChatMessage[] = [...sysMsg, ...history.filter((m) => m.content.trim() && m.role !== 'tool').map((m) => ({ role: m.role as 'user'|'assistant', content: m.content }))];
    let full = '';
    const stream = provider.chat(chatMessages, { model: currentModel });
    for await (const chunk of stream) {
      full += chunk.delta;
      updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantId) u[u.length - 1] = { ...last, content: full }; return u; });
    }
    updateSession((prev) => { const last = prev[prev.length - 1]; if (last?.id === assistantId && !last.content.trim()) return prev.slice(0, -1); return prev; });
    if (history.length <= 1 && full) {
      const title = history[0]?.content?.slice(0, 30) + (history[0]?.content?.length > 30 ? '...' : '') || '新对话';
      updateSessionMeta({ title });
    }
  }, [currentModel, systemPrompt, getBoundPromptsContent, getProvider, updateSession, updateSessionMeta]);

  const runAgentChat = useCallback(async (history: Message[], assistantId: string, userContent: string) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');
    const chatHistory: ChatMessage[] = history.filter((m) => m.content.trim() && m.role !== 'tool').map((m) => ({ role: m.role as 'user'|'assistant', content: m.content }));
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();

    // 注入绑定提示词到 system prompt 层面
    const boundContent = getBoundPromptsContent();
    const agentUserContent = boundContent
      ? `[系统绑定提示词]\n${boundContent}\n\n---\n\n${userContent}`
      : userContent;

    let thinkingText = '';
    let currentToolCalls: ToolCall[] = [];
    for await (const step of runAgent(provider, agentUserContent, chatHistory, currentModel)) {
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
  }, [currentModel, getProvider, updateSession]);

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
  }, [input, streaming, messages, agentMode, runChat, runAgentChat, updateSession]);

  // ── 重新生成 / 编辑 ──
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
  }, [streaming, messages, agentMode, runChat, runAgentChat, updateSession]);

  const handleStartEdit = useCallback((msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (msg) { setEditValue(msg.content); setEditingMsgId(msgId); }
  }, [messages]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingMsgId || streaming) return;
    const idx = messages.findIndex((m) => m.id === editingMsgId);
    if (idx === -1) return;
    const trimmed = messages.slice(0, idx);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: editValue, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...trimmed, userMsg];
    updateSession(() => [...newHistory, assistantMsg]);
    setEditingMsgId(null);
    setStreaming(true);
    setError(null);
    try {
      if (agentMode) await runAgentChat(newHistory, assistantMsg.id, editValue);
      else await runChat(newHistory, assistantMsg.id);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
        updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantMsg.id && !last.content) u[u.length - 1] = { ...last, content: `❌ ${err?.message ?? '请求失败'}` }; return u; });
      }
    } finally { setStreaming(false); }
  }, [editingMsgId, streaming, messages, agentMode, runChat, runAgentChat, updateSession]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => { updateSession(() => []); setError(null); }, [updateSession]);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return {
    // state
    sessions, activeSessionId, setActiveSessionId, showHistory, setShowHistory,
    messages, systemPrompt, currentModel, hasKey,
    input, setInput, streaming, agentMode, setAgentMode, error,
    sysPromptOpen, setSysPromptOpen,
    editingMsgId, editValue, setEditValue, setEditingMsgId,
    // refs
    inputRef, scrollRef,
    // handlers
    handleNewSession, handleDeleteSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear, handleKeyDown,
    handleStartEdit, handleSaveEdit,
    updateSessionMeta,
    // 绑定提示词
    boundPromptIds, toggleBoundPrompt, getBoundPromptsContent,
  };
}
