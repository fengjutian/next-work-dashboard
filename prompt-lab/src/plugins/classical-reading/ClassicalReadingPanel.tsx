import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, notification } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  Check,
  Copy,
  History,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import {
  dbDeleteClassicalReading,
  dbLoadClassicalReadings,
  dbSaveClassicalReading,
  flushDbToDisk,
  isDbReady,
  type ClassicalReading,
} from '@/db';
import { useStore } from '@/store/store';

// ── System Prompt ── 古典文言文精读老师的完整指引
// 编码上一轮 ljg-classic skill 的核心 10 条原则 + 5 段输出结构。
const SYSTEM_PROMPT = `你是一名"古典文言文精读老师"。把用户给出的古文段落，转成"逐字解读 + 章节释义"知识卡片。
你不是翻译机，你是精读老师。

# 核心原则（必须遵守）
1. 不只翻译，要解释"为什么这样翻译"。每条字词解释都要让读者知道这个词在本句中为什么取这个义。
2. 区分四义：字面义（字的本义）、古义（先秦两汉语境下的常见义）、句中义（在本句里实际取的义）、现代义（现代汉语里残留的对应义）。
3. 通假字、古今异义、词类活用（名词作动词 / 意动 / 使动）必须显式说明。
4. 长句做句法拆解：主谓宾定状补、省略成分、特殊语序（宾语前置、状语后置）。
5. 翻译忠于原文，不为通俗而增减。
6. 章节层面做思想解释，不只是词义堆叠。
7. 不要把现代价值观强行套入古文。古代的"忠"不等于今天的"忠诚"，需注明语义边界。
8. 存在争议时用「常见解释 / 一种解释 / 存在争议 / 旧注 / 今按」明确措辞，不要伪装成定论。
9. 佛道文本分三层：原文字面 / 传统注疏 / 现代通俗理解。三层不能混说。
10. 不用网络梗解释古文，不为押韵或文气改原文。

# 输出结构（严格按此顺序，使用 Markdown）
### ① 原文
完整展示本段原文，不增删、不改字、不"美化"标点。如果有异体字/异文，先固定底本（注明"底本采用《……》"），再写正文。

### ② 逐句拆解
按原文断句，每一句一组，模板如下：
- 【原文】> 原句
- 【逐字解】表格：| 字词 | 解释（标注属于字面义/古义/句中义/现代义） |
- 【句法】主谓宾定状补、省略成分、特殊语序
- 【直译】忠于原文的现代汉语
- 【一句话理解】最简单的话

### ③ 章节释义
1. 这一品/这一章讲了什么？（事实层）
2. 为什么要这样写？（修辞/论证策略/篇章结构）
3. 前后文是什么关系？
4. 核心概念是什么？（3~7 个，见 ④）
5. 普通现代人应该如何理解？

### ④ 核心概念
提炼 3~7 个关键词，每个用：
**概念：<词>**
- 原文含义：<此词在本章中的具体所指>
- 古典语境：<先秦/汉魏/唐宋/佛道语境里的常见义>
- 本章中的含义：<本章赋予的特定义>
- 现代语言：<现代汉语能最贴近对译的词或短句>

### ⑤ 一句话总结
用一句非常简洁、有思想性但不故作高深的话总结本章。30 字以内优先。

# 风格与禁忌
- 不加开场白、不加结束语，开头直接是 "### ① 原文"。
- 不为生动而增减原意。
- 标注争议时直接说"这里历来有 A / B 两种解释，本卡采用 A，理由是……"。
- 佛道文本不把"空""无""道""涅槃""般若"直接等同于现代哲学概念。
- 出处未明的，先按用户给定的体裁做；不要凭"看着像"硬套到《论语》《道德经》上。

输出格式：纯 Markdown，不要任何开场白或结束语。`;

const EXAMPLES: Array<{ source: string; text: string }> = [
  {
    source: '《论语·学而》第一章',
    text: '子曰："学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？"',
  },
  {
    source: '《道德经》第一章',
    text: '道可道，非常道。名可名，非常名。无名天地之始；有名万物之母。',
  },
  {
    source: '《岳阳楼记》第三段',
    text: '嗟夫！予尝求古仁人之心，或异二者之为，何哉？不以物喜，不以己悲。',
  },
];

const MAX_TEXT_LENGTH = 4000;

async function llmChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, {
    model,
    temperature: 0.5,
    maxTokens: 8_192,
    stream: true,
  })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }
  return chunks.join('').trim();
}

function errorMessage(reason: unknown): string {
  if (!(reason instanceof Error)) return '生成失败，请稍后重试';
  if (/aborted|aborterror/i.test(reason.message))
    return '生成请求被中止，请重试；如果持续出现，请更换响应更快的模型';
  return reason.message;
}

function defaultTitle(source: string, text: string): string {
  if (source.trim()) return source.trim();
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact;
}

export const ClassicalReadingPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [modal, modalHolder] = Modal.useModal();
  const [notice, noticeHolder] = notification.useNotification();

  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ClassicalReading | null>(null);
  const [history, setHistory] = useState<ClassicalReading[]>([]);
  const [copied, setCopied] = useState(false);
  const requestIdRef = useRef(0);
  const copyTimerRef = useRef<number>();

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const reloadHistory = useCallback(() => {
    if (!isDbReady()) return false;
    try {
      setHistory(dbLoadClassicalReadings());
    } catch {
      setHistory([]);
    }
    return true;
  }, []);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (reloadHistory() || attempts >= 30) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [reloadHistory]);

  const persist = useCallback(
    async (record: Omit<ClassicalReading, 'id' | 'createdAt'>): Promise<string | null> => {
      if (!isDbReady()) return null;
      try {
        const id = crypto.randomUUID();
        dbSaveClassicalReading({ ...record, id, createdAt: Date.now() });
        await flushDbToDisk();
        reloadHistory();
        return id;
      } catch {
        return null;
      }
    },
    [reloadHistory],
  );

  const handleDelete = useCallback(
    (record: ClassicalReading) => {
      modal.confirm({
        title: `删除「${record.title}」？`,
        content: '删除后无法恢复，精读卡片会从本地历史中移除。',
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            dbDeleteClassicalReading(record.id);
            await flushDbToDisk();
            setHistory((list) => list.filter((item) => item.id !== record.id));
            setCurrent((currentItem) => (currentItem?.id === record.id ? null : currentItem));
            notice.success({
              message: '删除成功',
              description: '这条古文阅读记录已从本地历史中删除。',
              placement: 'bottomRight',
            });
          } catch {
            notice.error({
              message: '删除失败',
              description: '记录暂时无法删除，请稍后重试。',
              placement: 'bottomRight',
            });
          }
        },
      });
    },
    [modal, notice],
  );

  const handleSelectHistory = useCallback((record: ClassicalReading) => {
    setSource(record.source);
    setText(record.originalText);
    setError(record.error || null);
    setCurrent(record);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    if (trimmed.length > MAX_TEXT_LENGTH) {
      setError(`原文请控制在 ${MAX_TEXT_LENGTH} 个字符以内`);
      return;
    }
    if (!isDbReady()) {
      setError('本地数据库正在初始化，请稍后再试');
      return;
    }
    if (!aiApi.apiKey?.trim() || !aiApi.baseUrl?.trim() || !aiApi.model?.trim()) {
      setError('请先在设置中完整配置 AI 服务、API Key 和模型');
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const userContent = source.trim()
        ? `【出处】${source.trim()}\n【原文】\n${trimmed}`
        : `【原文】\n${trimmed}`;
      const raw = await llmChat(
        aiApi.apiKey,
        aiApi.baseUrl,
        aiApi.model,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      );
      if (!raw) throw new Error('模型没有返回内容，请重新生成');
      const title = defaultTitle(source, trimmed);
      const id = await persist({
        title,
        source: source.trim(),
        originalText: trimmed,
        status: 'success',
        content: raw,
        error: '',
        model: aiApi.model,
      });
      if (requestId !== requestIdRef.current) return;
      setCurrent({
        id: id ?? `pending-${Date.now()}`,
        title,
        source: source.trim(),
        originalText: trimmed,
        status: 'success',
        content: raw,
        error: '',
        model: aiApi.model,
        createdAt: Date.now(),
      });
    } catch (reason) {
      const message = errorMessage(reason);
      await persist({
        title: defaultTitle(source, trimmed),
        source: source.trim(),
        originalText: trimmed,
        status: 'error',
        content: '',
        error: message,
        model: aiApi.model,
      });
      if (requestId === requestIdRef.current) setError(message);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [aiApi, loading, persist, source, text]);

  const handleCopy = useCallback(async () => {
    if (!current?.content) return;
    try {
      await navigator.clipboard.writeText(current.content);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      notice.error({
        message: '无法访问剪贴板',
        description: '请手动选中卡片内容复制。',
        placement: 'bottomRight',
      });
    }
  }, [current, notice]);

  const handleRegenerate = useCallback(() => {
    if (loading || !text.trim()) return;
    void handleGenerate();
  }, [handleGenerate, loading, text]);

  const handleUseExample = useCallback(
    (example: { source: string; text: string }) => {
      setSource(example.source);
      setText(example.text);
      setError(null);
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      {modalHolder}
      {noticeHolder}

      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">古文阅读</h1>
            <p className="truncate text-xs text-muted-foreground">
              逐字解读 + 章节释义，把一段古文变成可读的知识卡片
            </p>
          </div>
        </div>
        <div
          className="hidden max-w-52 truncate rounded-full border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground sm:block"
          title={aiApi.model || '未配置模型'}
        >
          {aiApi.model || '未配置模型'}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:overflow-hidden">
        {/* 左侧：输入 + 历史 */}
        <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-auto">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">贴一段古文</h2>
            </div>
            <label className="mb-2 block text-xs text-muted-foreground">
              出处（选填）
              <input
                value={source}
                maxLength={60}
                onChange={(event) => {
                  setSource(event.target.value);
                  setError(null);
                }}
                placeholder="例如：《论语·学而》第一章"
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              原文
              <textarea
                value={text}
                maxLength={MAX_TEXT_LENGTH}
                rows={8}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    void handleGenerate();
                  }
                }}
                placeholder="把要精读的古文粘贴在这里……"
                className="mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Ctrl / ⌘ + Enter 生成</span>
              <span className={text.length >= MAX_TEXT_LENGTH ? 'text-destructive' : ''}>
                {text.length}/{MAX_TEXT_LENGTH}
              </span>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={loading || !text.trim()}
              onClick={() => void handleGenerate()}
            >
              {loading ? <Loader2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {loading ? '正在精读…' : '生成精读卡片'}
            </Button>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="text-xs font-medium text-muted-foreground">先看几篇</h2>
            <div className="mt-3 flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example.source}
                  type="button"
                  disabled={loading}
                  onClick={() => handleUseExample(example)}
                  className="rounded-lg border bg-background px-3 py-2 text-left text-xs transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                >
                  <div className="font-medium">{example.source}</div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {example.text}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-dashed bg-background/50 p-4 text-xs leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">使用说明</p>
            <p className="mt-1">
              AI 会按「原文 → 逐句拆解 → 章节释义 → 核心概念 → 一句话总结」五段输出纯 Markdown 卡片。
              出处可填可不填；填了有助于 AI 选底本。
            </p>
          </section>

          {history.length > 0 && (
            <section className="rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-medium">最近阅读</h2>
                <span className="ml-auto text-[10px] text-muted-foreground">SQLite</span>
              </div>
              <div className="mt-3 space-y-1">
                {history.slice(0, 12).map((record) => (
                  <div
                    key={record.id}
                    className={`group flex items-center rounded-lg transition hover:bg-accent ${
                      current?.id === record.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectHistory(record)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          record.status === 'success' ? 'bg-success' : 'bg-destructive'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {record.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={`删除「${record.title}」`}
                      aria-label={`删除「${record.title}」`}
                      onClick={() => handleDelete(record)}
                      className="mr-1 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>

        {/* 右侧：精读卡片 */}
        <section className="relative flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm lg:min-h-0">
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">
                {current ? `「${current.title}」` : '精读卡片'}
              </h2>
            </div>
            {current && current.status === 'success' && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '已复制' : '复制 Markdown'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || !text.trim()}
                  onClick={() => void handleRegenerate()}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  重新生成
                </Button>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span>{error}</span>
              {text.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => void handleGenerate()}
                >
                  重试
                </Button>
              )}
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-auto p-6">
            {current && current.status === 'success' ? (
              <article className="markdown-reading mx-auto w-full max-w-3xl">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.content}</ReactMarkdown>
              </article>
            ) : !loading ? (
              <div className="flex min-h-full items-center justify-center">
                <div className="max-w-sm text-center">
                  <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border bg-background text-primary shadow-sm">
                    <BookOpen className="h-11 w-11" />
                  </div>
                  <h2 className="mt-5 text-base font-medium">从一段古文开始</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    粘贴任意古文段落（论语、道德经、楚辞、唐宋古文、佛经道经皆可），生成包含逐字解读与章节释义的知识卡片。
                  </p>
                </div>
              </div>
            ) : null}

            {loading && (
              <div className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 text-primary" />
                  <p className="text-sm font-medium">
                    正在精读「{text.trim().slice(0, 16)}{text.trim().length > 16 ? '…' : ''}」
                  </p>
                  <p className="text-xs text-muted-foreground">
                    逐字拆解、章节释义、概念提炼…
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
