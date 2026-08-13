import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, Loader2, Send, Sparkles } from '@/components/icons';
import { useStore } from '@/store/store';
import type { ChatMessage } from '@/core/llm';
import type { LessonContent } from './lessons';
import { streamTutorReply, type TutorDepth } from './ai-tutor';

export function AITutor({ lesson, mastery }: { lesson: LessonContent; mastery: number }) {
  const aiApi = useStore(state => state.aiApi);
  const [depth, setDepth] = useState<TutorDepth>('标准');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setMessages([]); setError(''); controller.current?.abort(); }, [lesson.id]);
  useEffect(() => () => controller.current?.abort(), []);
  const ask = async (question = input.trim()) => {
    if (!question || loading) return;
    const history = messages; setInput(''); setError(''); setLoading(true);
    setMessages([...history, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    controller.current = new AbortController();
    try {
      const answer = await streamTutorReply(aiApi, lesson, mastery, depth, history, question, (text) => setMessages([...history, { role: 'user', content: question }, { role: 'assistant', content: text }]), controller.current.signal);
      setMessages([...history, { role: 'user', content: question }, { role: 'assistant', content: answer }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 导师暂时无法回答'); setMessages(history); } finally { setLoading(false); }
  };
  const starters = [`用高中生能理解的方式解释${lesson.title}`, `为什么学习${lesson.title}？`, `给我一个反直觉的例子`, `检查我的先修知识`];
  return <section className="overflow-hidden rounded-3xl border border-cyan-900/20 bg-[#102d38] text-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/15"><Bot className="h-5 w-5 text-cyan-200" /></div><div><h2 className="font-semibold">AI 私人导师</h2><p className="text-xs text-slate-400">根据你的掌握度展开，不参与数学判题</p></div></div><div className="flex rounded-lg bg-black/20 p-1">{(['直觉','标准','严格'] as TutorDepth[]).map(item => <button key={item} onClick={() => setDepth(item)} className={`rounded-md px-3 py-1.5 text-xs ${depth === item ? 'bg-white text-slate-900' : 'text-slate-300'}`}>{item}</button>)}</div></header>
    <div className="max-h-[480px] space-y-4 overflow-auto p-5">{messages.length === 0 && <><div className="rounded-2xl bg-white/7 p-5"><div className="flex items-center gap-2 text-sm font-medium text-cyan-200"><Sparkles className="h-4 w-4" />我已经读过本节课程</div><p className="mt-2 text-sm leading-6 text-slate-300">你可以让我换一种讲法、追问推导中的某一步，或让我检查你缺少哪项高中基础。</p></div><div className="flex flex-wrap gap-2">{starters.map(item => <button key={item} onClick={() => void ask(item)} className="rounded-full border border-white/15 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">{item}</button>)}</div></>}
      {messages.map((message, index) => message.role !== 'system' && <div key={`${message.role}-${index}`} className={`rounded-2xl p-4 text-sm leading-7 ${message.role === 'user' ? 'ml-10 bg-cyan-700/30' : 'mr-6 bg-white/8 text-slate-200'}`}><ReactMarkdown>{message.content || '正在思考…'}</ReactMarkdown></div>)}
      {loading && <div className="flex items-center gap-2 text-xs text-cyan-200"><Loader2 className="h-4 w-4" />正在组织讲解</div>}{error && <div className="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{error}</div>}
    </div>
    <div className="border-t border-white/10 p-4"><div className="flex gap-2"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder={`问导师关于“${lesson.title}”的问题…`} className="min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-cyan-400" /><button disabled={!input.trim() || loading} onClick={() => void ask()} className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40"><Send className="h-4 w-4" /></button></div></div>
  </section>;
}
