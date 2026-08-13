import type { FormEvent, RefObject } from 'react';
import { Loader2, Search, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { LookupHistoryItem } from './types';

interface Props {
  query: string; targetWord: string; loading: boolean; history: LookupHistoryItem[];
  voiceLocale: 'en-US' | 'en-GB'; speechRate: number; inputRef: RefObject<HTMLInputElement>;
  onQuery: (value: string) => void; onTarget: (value: string) => void; onSubmit: () => void;
  onHistory: (value: string) => void; onClearHistory: () => void; onArticle: () => void;
  onVoice: (value: 'en-US' | 'en-GB') => void; onRate: (value: number) => void;
}

export function LookupToolbar(props: Props) {
  const submit = (event: FormEvent) => { event.preventDefault(); props.onSubmit(); };
  return <section className="mx-auto mb-5 w-full max-w-4xl rounded-xl border bg-card p-3 shadow-sm sm:p-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">英语查询</span>{props.history.slice(0, 5).map((item) => <button key={item.query} onClick={() => props.onHistory(item.query)} className="max-w-32 truncate rounded-full bg-muted px-2.5 py-1 text-[11px] hover:bg-accent">{item.query}</button>)}{props.history.length > 0 && <button onClick={props.onClearHistory} className="text-[11px] text-muted-foreground hover:text-foreground">清空</button>}<Button className="ml-auto" size="sm" variant="outline" onClick={props.onArticle}>文章阅读</Button></div><form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><input ref={props.inputRef} autoFocus value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="输入单词、短语或英文句子" className="h-10 w-full rounded-lg border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"/></div><Button disabled={props.loading} type="submit">{props.loading ? <Loader2 className="mr-2 h-4 w-4"/> : <Sparkles className="mr-2 h-4 w-4"/>}AI 查询</Button></form><div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2"><span className="text-[11px] text-muted-foreground">语境目标</span><input value={props.targetWord} onChange={(event) => props.onTarget(event.target.value)} placeholder="可选，例如 run into" className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs"/><select aria-label="发音口音" value={props.voiceLocale} onChange={(event) => props.onVoice(event.target.value as Props['voiceLocale'])} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="en-US">美音</option><option value="en-GB">英音</option></select><select aria-label="朗读语速" value={props.speechRate} onChange={(event) => props.onRate(Number(event.target.value))} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="0.75">0.75×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></div></section>;
}
