import React, { useState } from 'react';
import { Robot, Copy, Check, Wrench, RotateCcw, Edit3 } from '@/components/icons';
import type { ToolCall, ToolResult } from '@/core';

// ── 消息/会话类型 ──

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// ── 代码块 ──

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

// ── 工具调用卡片 ──

export const ToolCallCard: React.FC<{ calls: ToolCall[]; results?: ToolResult[] }> = ({ calls, results }) => (
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

// ── Markdown 渲染 ──

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

export const MessageBubble: React.FC<{
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
      {!isUser && canRegenerate && onRegenerate && !editing && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="重新生成" onClick={onRegenerate}><RotateCcw className="h-3.5 w-3.5" /></button>
      )}
      {isUser && canEdit && onEdit && !editing && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="编辑" onClick={onEdit}><Edit3 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
};
