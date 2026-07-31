import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/store';
import { createOpenAIProvider, registerTools, runAgent } from '@/core';
import { builtInTools } from '@/core/tools';
import { pluginTools } from '@/core/tools/plugin-tools';
import type { ChatMessage, LLMProvider, ToolCall, ToolResult } from '@/core';
import type { Message } from './MessageBubble';
import type { Prompt } from '@/store/types';

// ── Bubble.List 兼容的消息状态 ──
export type MessageStatus = 'local' | 'loading' | 'updating' | 'success' | 'error' | 'abort';

/** 将 Message 转为 Bubble.List items 所接受的格式 */
export function toBubbleItems(messages: Message[], streaming: boolean, error: string | null) {
  // 找到最后一条 user 消息的索引
  let lastUserIdx = -1;
  let lastAiIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && lastUserIdx === -1) lastUserIdx = i;
    if (messages[i].role === 'assistant' && lastAiIdx === -1) lastAiIdx = i;
    if (lastUserIdx !== -1 && lastAiIdx !== -1) break;
  }

  return messages.map((msg, idx, arr) => {
    const isLast = idx === arr.length - 1;
    const isLastUser = idx === lastUserIdx;
    const isLastAi = idx === lastAiIdx;
    let status: MessageStatus | undefined;
    if (msg.role === 'assistant') {
      if (isLast && streaming) status = 'loading';
      else if (isLast && error) status = 'error';
      else if (!msg.content.trim() && !msg.toolCalls?.length) status = 'loading';
    }
    const role = msg.role === 'assistant' ? 'ai' : msg.role;
    return {
      key: msg.id,
      role,
      content: msg.content,
      status,
      // streaming 是 per-item 的，不在 role 配置中
      streaming: isLast && streaming,
      // 最后一条 user 消息（非 streaming 时）可编辑
      editable: role === 'user' && isLastUser && !streaming,
      extraInfo: {
        toolCalls: msg.toolCalls,
        toolResults: msg.toolResults,
        timestamp: msg.timestamp,
        originalRole: msg.role,
        isLastAi: msg.role === 'assistant' && isLastAi,
      },
    };
  });
}

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
  const abortRef = useRef<AbortController | null>(null);
  const providerRef = useRef<LLMProvider | null>(null);

  useEffect(() => { providerRef.current = null; }, [aiApi.apiKey, aiApi.baseUrl]);

  const getProvider = useCallback((): LLMProvider | null => {
    if (!aiApi.apiKey) return null;
    if (providerRef.current) return providerRef.current;
    providerRef.current = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
    return providerRef.current;
  }, [aiApi.apiKey, aiApi.baseUrl]);

  // 提示词注入（仅启用状态的提示词）
  useEffect(() => {
    if (selectedPromptId && promptDrawerOpen === false) {
      const p = prompts.find((pp) => pp.id === selectedPromptId);
      if (p && p.enabled !== false && !streaming) { setInput((prev) => (prev ? prev + '\n' + p.content : p.content)); }
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

  const handleRenameSession = useCallback((id: string) => {
    const name = window.prompt('请输入新名称');
    if (name) {
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: name } : s));
    }
  }, []);

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
  const runChat = useCallback(async (history: Message[], assistantId: string, signal?: AbortSignal) => {
    const provider = getProvider();
    if (!provider) throw new Error('请先配置 API Key');
    const boundContent = getBoundPromptsContent();
    const fullSystemPrompt = [systemPrompt.trim(), boundContent].filter(Boolean).join('\n\n');
    const sysMsg = fullSystemPrompt ? [{ role: 'system' as const, content: fullSystemPrompt }] : [];
    const chatMessages: ChatMessage[] = [...sysMsg, ...history.filter((m) => m.content.trim() && m.role !== 'tool').map((m) => ({ role: m.role as 'user'|'assistant', content: m.content }))];
    let full = '';
    const stream = provider.chat(chatMessages, { model: currentModel, signal });
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

  const runAgentChat = useCallback(async (history: Message[], assistantId: string, userContent: string, signal?: AbortSignal) => {
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
    for await (const step of runAgent(provider, agentUserContent, chatHistory, currentModel, { signal })) {
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
  const handleSend = useCallback(async (directText?: string) => {
    const text = (directText ?? input).trim();
    if (!text || streaming) return;
    if (!directText) setInput('');
    setError(null);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...messages, userMsg];
    updateSession(() => [...newHistory, assistantMsg]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (agentMode) await runAgentChat(newHistory, assistantMsg.id, text, ctrl.signal);
      else await runChat(newHistory, assistantMsg.id, ctrl.signal);
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
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (agentMode) await runAgentChat(trimmed, assistantMsg.id, lastUser.content, ctrl.signal);
      else await runChat(trimmed, assistantMsg.id, ctrl.signal);
    } catch (err: any) { if (err.name !== 'AbortError') setError(err?.message ?? '请求失败'); }
    finally { setStreaming(false); }
  }, [streaming, messages, agentMode, runChat, runAgentChat, updateSession]);

  /** Bubble editable 的确认回调 — 编辑最后一条用户消息并重发 */
  const handleEditConfirm = useCallback(async (newContent: string) => {
    if (streaming) return;
    // 找到最后一条 user 消息
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const trimmed = messages.slice(0, lastUserIdx);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: newContent, timestamp: Date.now() };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    const newHistory = [...trimmed, userMsg];
    updateSession(() => [...newHistory, assistantMsg]);
    setStreaming(true);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (agentMode) await runAgentChat(newHistory, assistantMsg.id, newContent, ctrl.signal);
      else await runChat(newHistory, assistantMsg.id, ctrl.signal);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message ?? '请求失败');
        updateSession((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.id === assistantMsg.id && !last.content) u[u.length - 1] = { ...last, content: `❌ ${err?.message ?? '请求失败'}` }; return u; });
      }
    } finally { setStreaming(false); }
  }, [streaming, messages, agentMode, runChat, runAgentChat, updateSession]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => { updateSession(() => []); setError(null); }, [updateSession]);

  return {
    // state
    sessions, activeSessionId, setActiveSessionId, showHistory, setShowHistory,
    messages, systemPrompt, currentModel, hasKey,
    input, setInput, streaming, agentMode, setAgentMode, error,
    sysPromptOpen, setSysPromptOpen,
    // handlers
    handleNewSession, handleDeleteSession, handleRenameSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear,
    handleEditConfirm,
    updateSessionMeta,
    // 绑定提示词
    boundPromptIds, toggleBoundPrompt, getBoundPromptsContent,
  };
}
