/**
 * FollowupDialog — 单星座追问
 *
 * 保留原问题 + 本轮视角回答 + 历史对话；system prompt 里始终带"我是 XX 视角"。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, MessageSquare, RefreshCw, Copy, Loader2, ShieldAlert } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ZODIAC_META } from '../zodiac-data';
import { copyText } from '../zodiac-copy';
import type { ZodiacFollowupMessage, ZodiacRun, ZodiacSign } from '../zodiac-types';
import { generateFollowup, type FollowupTurn } from '../zodiac-service';
import { detectHighRisk } from '../zodiac-prompts';
import {
  appendFollowupMessage,
  loadFollowupMessages,
} from '../zodiac-storage';

export interface FollowupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: ZodiacRun | null;
  sign: ZodiacSign | null;
  apiKey: string;
  baseUrl: string;
  model: string;
  onCopy: (text: string, success: boolean) => void;
}

export function FollowupDialog({
  open,
  onOpenChange,
  run,
  sign,
  apiKey,
  baseUrl,
  model,
  onCopy,
}: FollowupDialogProps) {
  const [messages, setMessages] = useState<ZodiacFollowupMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highRisk, setHighRisk] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const perspective = useMemo(() => {
    if (!run || !sign) return null;
    return run.perspectives.find((p) => p.sign === sign) ?? null;
  }, [run, sign]);

  // 载入历史追问
  useEffect(() => {
    if (!open || !run || !sign) {
      abortRef.current?.abort();
      abortRef.current = null;
      setMessages([]);
      setError(null);
      setHighRisk(null);
      return;
    }
    setMessages(loadFollowupMessages(run.id).filter((m) => m.sign === sign) as unknown as ZodiacFollowupMessage[]);
  }, [open, run, sign]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  const handleSend = async () => {
    if (!run || !sign || !perspective) return;
    const text = input.trim();
    if (!text) return;
    setError(null);
    const risk = detectHighRisk(text);
    setHighRisk(risk ? `${risk.category}类问题：${risk.guidance}` : null);

    const userMsg: ZodiacFollowupMessage = {
      id: crypto.randomUUID(),
      runId: run.id,
      sign,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    appendFollowupMessage(userMsg);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const history: FollowupTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const answer = await generateFollowup(
        run.question,
        perspective,
        sign,
        history,
        text,
        { apiKey, baseUrl, model },
        controller.signal,
      );
      const aiMsg: ZodiacFollowupMessage = {
        id: crypto.randomUUID(),
        runId: run.id,
        sign,
        role: 'assistant',
        content: answer,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      appendFollowupMessage(aiMsg);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleCopyLast = async () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    const meta = sign ? ZODIAC_META[sign] : null;
    const ok = await copyText(`# ${meta?.glyph ?? ''} ${meta?.name ?? ''} · 追问回复\n\n${lastAssistant.content}\n\n> 本内容由 AI 生成，属于娱乐化的多视角启发，不构成专业意见。`);
    onCopy(`已复制 ${meta?.name ?? ''} 视角回复`, ok);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            {sign && <span className="text-2xl">{ZODIAC_META[sign].glyph}</span>}
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {sign ? ZODIAC_META[sign].name : ''} · 追问模式
              </h2>
              {sign && (
                <p className="text-xs text-muted-foreground">
                  {ZODIAC_META[sign].keywords.join(' · ')} · {ZODIAC_META[sign].focus}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleCopyLast} disabled={!messages.some((m) => m.role === 'assistant')}>
              <Copy className="h-3.5 w-3.5" /> 复制回复
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="关闭">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {perspective && (
          <div className="border-b border-border/40 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div><span className="font-medium text-foreground">原问题：</span>{run?.question}</div>
            <div className="mt-1 line-clamp-2"><span className="font-medium text-foreground">{sign && ZODIAC_META[sign].name} 视角：</span>{perspective.interpretation}</div>
          </div>
        )}

        {highRisk && (
          <div className="m-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{highRisk}</span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">
              <MessageSquare className="mx-auto mb-1 h-5 w-5" />
              开始与「{sign ? ZODIAC_META[sign].name : ''}」对话吧。可以追问细节、要求换种说法、或挑战它的建议。
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')
              }
            >
              <div
                className={
                  'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                  (m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border/60 bg-muted/40 text-foreground/90')
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5" /> {sign && ZODIAC_META[sign].name} 正在思考…
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <footer className="flex items-end gap-2 border-t border-border/60 px-3 py-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                if (!streaming) handleSend();
              }
            }}
            placeholder="向「这个星座视角」追问…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={streaming}
          />
          {streaming ? (
            <Button variant="outline" onClick={handleCancel}>
              <RefreshCw className="h-3.5 w-3.5" /> 取消
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-3.5 w-3.5" /> 发送
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
