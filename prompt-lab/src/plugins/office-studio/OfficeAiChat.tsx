import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Trash2 } from '@/components/icons';
import { createOpenAIProvider, registerTools, runAgent, type ChatMessage } from '@/core';
import { officeTools } from '@/core/tools/office-tools';
import { useStore } from '@/store';
import { OfficeApprovalDialog } from '@/plugins/chat/OfficeApprovalDialog';

registerTools(officeTools);
const OFFICE_TOOL_NAMES = officeTools.map((tool) => tool.name);
interface UiMessage { role: 'user' | 'assistant'; content: string }
interface Props { filePath: string; page?: number; selectedPath?: string; onDocumentChanged(): void }

export const OfficeAiChat: React.FC<Props> = ({ filePath, page, selectedPath, onDocumentChanged }) => {
  const aiApi = useStore((state) => state.aiApi);
  const storageKey = useMemo(() => `office-studio:chat:${filePath}`, [filePath]);
  const [messages, setMessages] = useState<UiMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]') as UiMessage[]; } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40))); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, storageKey]);

  const send = async () => {
    const prompt = input.trim(); if (!prompt || running) return;
    if (!aiApi.apiKey) { setMessages((current) => [...current, { role: 'assistant', content: '请先在设置中配置 AI API。' }]); return; }
    setInput(''); setRunning(true);
    const user: UiMessage = { role: 'user', content: prompt };
    setMessages((current) => [...current, user, { role: 'assistant', content: '正在分析文档…' }]);
    const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, chatProxy: aiApi.provider === 'qwen' ? window.electronAPI.llmChat : undefined });
    const history: ChatMessage[] = messages.map((message) => ({ role: message.role, content: message.content }));
    let answer = '';
    let changed = false;
    const context = [`当前 Office 文件：${filePath}`, page ? `当前幻灯片：${page}` : '', selectedPath ? `当前选中元素：${selectedPath}` : ''].filter(Boolean).join('\n');
    try {
      for await (const step of runAgent(provider, `${context}\n\n用户要求：${prompt}`, history, aiApi.model, {
        maxSteps: 8,
        allowedToolNames: OFFICE_TOOL_NAMES,
        systemPrompt: `你是 Office Studio 内嵌文档编辑助手。始终操作上下文给出的当前文件，不要要求用户重复提供路径。先用 office_read/office_query/office_get_element 理解文档，再按用户要求调用 Office 写工具。修改 PPT 时优先操作当前幻灯片。不要只给命令或教程；用户要求编辑时应实际调用工具。所有写操作会由界面请求用户审批。`,
      })) {
        if (step.type === 'answer') answer = step.content || answer;
        if (step.type === 'act' && step.toolCalls?.some((call) => ['office_update', 'office_add', 'office_remove', 'office_merge', 'office_undo', 'office_redo'].includes(call.name))) changed = true;
        if (step.type === 'think' && step.content) setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: step.content || '正在处理…' }]);
      }
      setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: answer || '操作已完成。' }]);
      if (changed) onDocumentChanged();
    } catch (error) {
      setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: `处理失败：${error instanceof Error ? error.message : String(error)}` }]);
    } finally { setRunning(false); }
  };

  return <aside className="relative flex h-full min-h-0 w-96 shrink-0 flex-col border-l bg-background">
    <header className="flex items-center gap-2 border-b px-3 py-2"><Bot className="h-4 w-4 text-primary" /><div className="flex-1"><h3 className="text-xs font-semibold">AI 编辑当前文档</h3><p className="max-w-72 truncate text-[10px] text-muted-foreground">{page ? `幻灯片 ${page}` : filePath.split(/[\\/]/).pop()}{selectedPath ? ` · ${selectedPath}` : ''}</p></div><button onClick={() => setMessages([])} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></button></header>
    <div className="min-h-0 flex-1 overflow-auto p-3">{messages.length ? messages.map((message, index) => <div key={index} className={`mb-3 rounded-lg p-2.5 text-xs leading-5 ${message.role === 'user' ? 'ml-8 bg-primary text-primary-foreground' : 'mr-4 bg-muted'}`}>{message.content}</div>) : <div className="space-y-2 text-xs text-muted-foreground"><p>直接描述希望怎样修改当前文档，例如：</p><button onClick={() => setInput('把当前幻灯片的标题改得更简洁')} className="block w-full rounded border p-2 text-left">把当前幻灯片的标题改得更简洁</button><button onClick={() => setInput('检查当前幻灯片是否有文字过多或布局问题，并直接修复')} className="block w-full rounded border p-2 text-left">检查布局并直接修复</button><button onClick={() => setInput('统一整份演示文稿的标题字体和颜色')} className="block w-full rounded border p-2 text-left">统一整份 PPT 风格</button></div>}<div ref={bottomRef} /></div>
    <div className="border-t p-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={3} className="w-full resize-none rounded border bg-card p-2 text-xs" placeholder="描述你希望 AI 如何编辑…" /><button disabled={running || !input.trim()} onClick={() => void send()} className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"><Send className="h-3.5 w-3.5" />{running ? 'AI 正在编辑…' : '发送并编辑'}</button></div>
    <OfficeApprovalDialog />
  </aside>;
};
