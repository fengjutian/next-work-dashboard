import React, { useState } from 'react';
import { Robot, Copy, Check, ChevronDown, Wrench, RotateCcw, Edit3 } from '@/components/icons';
import type { ToolCall, ToolResult } from '@/core';
import type { MemoryCitation } from '@/core/conversation-memory';

// ── 消息/会话类型 ──

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** 发送给模型的完整内容；界面仍只显示 content。 */
  contextContent?: string;
  timestamp: number;
  /** 生成该回答的模型；旧会话没有此字段时沿用会话默认模型。 */
  model?: string;
  /** 同一次多模型请求共享的标识，用于区分并行回答。 */
  comparisonId?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** 本次回答使用的知识库原始来源。 */
  memorySources?: MemoryCitation[];
}

// ── 代码块 ──

const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2 rounded-md border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted">
        <span className="text-[10px] text-muted-foreground uppercase">{lang || 'text'}</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs text-foreground font-mono leading-relaxed"><code>{code}</code></pre>
    </div>
  );
};

// ── 工具调用卡片 ──

export const ToolCallCard: React.FC<{ calls: ToolCall[]; results?: ToolResult[] }> = ({ calls, results }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
  <div className="my-2 overflow-hidden rounded-lg border bg-muted/30">
    {calls.map((call) => {
      const result = results?.find((r) => r.callId === call.id);
      const target = typeof call.arguments.path === 'string' ? call.arguments.path : '';
      const output = result?.output ?? '';
      const isExpanded = Boolean(expanded[call.id]);
      return (
        <div key={call.id} className="border-b px-3 py-2 last:border-b-0">
          <div className="flex items-center gap-2 text-xs">
            <Wrench className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">{call.name}</span>
            {target && <code className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={target}>{target}</code>}
            {!result && <span className="text-[10px] text-muted-foreground">运行中…</span>}
            {result?.error && <span className="text-[10px] text-destructive">失败</span>}
            {result && !result.error && <Check className="h-3.5 w-3.5 text-success" />}
            {!!(result?.error || output) && (
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent" onClick={() => setExpanded((value) => ({ ...value, [call.id]: !isExpanded }))} title={isExpanded ? '收起详情' : '查看详情'}>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
          {isExpanded && (
            <pre className={`mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-[10px] ${result?.error ? 'text-destructive' : 'text-muted-foreground'}`}>
              {result?.error ?? output ?? JSON.stringify(call.arguments, null, 2)}
            </pre>
          )}
        </div>
      );
    })}
  </div>
  );
};

// ── Markdown 渲染（导出供外部使用）──

export function renderMarkdown(text: string): React.ReactNode[] {
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

function renderContent(text: string): React.ReactNode[] {
  return renderMarkdown(text);
}

function inline(text: string, key: string): React.ReactNode {
  const segs = text.split(/(`[^`]+`)/g);
  return <span key={key} className="whitespace-pre-wrap break-words">{segs.map((s, i) => {
    if (s.startsWith('`') && s.endsWith('`')) return <code key={i} className="px-1 py-0.5 bg-accent rounded text-xs font-mono">{s.slice(1, -1)}</code>;
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
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-primary text-white' : isTool ? 'bg-warning text-white' : 'bg-success text-white'}`}>
        {isUser ? <span className="text-xs font-bold">U</span> : isTool ? <Wrench className="h-3.5 w-3.5" /> : <Robot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${isUser ? 'bg-primary text-white' : isTool ? 'bg-warning/10 bg-warning/10 border border-warning border-warning' : 'bg-muted text-foreground'}`}>
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea className="w-full bg-card text-foreground border rounded p-1.5 text-xs resize-none" rows={3} value={editValue} onChange={(e) => onEditChange?.(e.target.value)} autoFocus />
            <div className="flex gap-1 justify-end">
              <button className="text-[10px] px-2 py-0.5 rounded bg-accent" onClick={onEditCancel}>取消</button>
              <button className="text-[10px] px-2 py-0.5 rounded bg-primary text-white" onClick={onEditSave}>保存并重发</button>
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
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground" title="重新生成" onClick={onRegenerate}><RotateCcw className="h-3.5 w-3.5" /></button>
      )}
      {isUser && canEdit && onEdit && !editing && (
        <button className="self-center opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground" title="编辑" onClick={onEdit}><Edit3 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
};
