import React, { useCallback, useRef, useState } from 'react';
import { Send, Copy, Download, RefreshCw, Loader2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';

// ── System Prompt (derived from the Lisp DSL) ──

const SYSTEM_PROMPT = `你是一个"新汉语老师"——年轻人,批判现实,思考深刻,语言风趣。
你的风格融合了 Oscar Wilde 的犀利、鲁迅的深刻和罗永浩的幽默。
你擅长一针见血地揭示事物的本质,用隐喻来表达,用讽刺幽默来批判。

当用户输入一个词汇,你需要:
1. 用一句精练的隐喻来揭示这个词的本质,一针见血,辛辣讽刺,但又不失幽默
2. 同时提供这个词的英文和日文翻译
3. 最终将一切呈现在一张 SVG 卡片中

SVG 卡片设计规则:
- 画布 400×600,边距 20
- 设计原则:干净、简洁、典雅,合理使用负空间,整体排版要有呼吸感
- 配色:背景使用蒙德里安风格色块分割,有设计感;主要文字使用典雅的深灰/粉笔灰
- 卡片元素(自上而下):
  a. 居中标题"汉语新解",使用毛笔楷体风格(可用仿宋/serif 字体模拟)
  b. 一条细分隔线
  c. 用户输入的中文词汇(大字突出)、英文、日文
  d. 核心解释文(隐喻式、讽刺、一针见血)
  e. 一条简约线条图(用 SVG path/线条来表达解释的"批判内核")
  f. 极简总结——一行小字,凝练概括线条图表达的意思

Few-shot 示例:
- 用户输入"委婉",解释:"刺向他人时,决定在剑刃上撒上止痛药。"

直接输出纯 SVG 代码,不要包裹在 \`\`\`svg 中,不要加任何解释文字。`;

// ── Helper: read LLM stream into a string ──

async function llmChat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[]): Promise<string> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, { model, temperature: 0.9, stream: true })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }
  return chunks.join('');
}

// ── Component ──

export const HanyuJinjiePanel: React.FC = () => {
  const aiApi = useStore((s) => s.aiApi);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const handleGenerate = useCallback(async () => {
    const word = input.trim();
    if (!word) return;
    setLoading(true);
    setError(null);
    setSvgContent(null);

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: word },
      ];
      const raw = await llmChat(aiApi.apiKey, aiApi.baseUrl, aiApi.model, messages);
      // Strip possible markdown code fences
      let svg = raw.trim();
      svg = svg.replace(/^```(?:svg|xml|html)?\s*\n?/i, '').replace(/\n?```$/i, '');
      setSvgContent(svg);
    } catch (e: any) {
      setError(e?.message ?? '生成失败');
    } finally {
      setLoading(false);
    }
  }, [input, aiApi]);

  const handleCopy = useCallback(async () => {
    if (!svgContent) return;
    try {
      await navigator.clipboard.writeText(svgContent);
    } catch {
      // Fallback: select text
      const el = svgContainerRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [svgContent]);

  const handleDownload = useCallback(() => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `汉语新解-${input.trim() || 'card'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [svgContent, input]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background shrink-0">
        <span className="text-sm font-semibold">汉语新解</span>
        <span className="text-xs text-muted-foreground">输入一个词，看它被如何解构</span>
      </div>

      {/* Input area */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleGenerate(); }}
          placeholder="输入一个词汇，如：内卷、躺平、赋能..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button
          onClick={handleGenerate}
          disabled={loading || !input.trim()}
          size="icon"
          className="h-9 w-9 shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Result area */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 p-4 rounded-lg bg-red-50 dark:bg-red-950">
            <span>{error}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleGenerate}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">正在解构「{input}」...</span>
          </div>
        )}

        {svgContent && !loading && (
          <div className="flex flex-col gap-3">
            {/* Toolbar */}
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                复制 SVG
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5 mr-1" />
                下载
              </Button>
              <Button variant="ghost" size="sm" onClick={handleGenerate}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                重新生成
              </Button>
            </div>

            {/* SVG preview */}
            <div
              ref={svgContainerRef}
              className="flex justify-center"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          </div>
        )}

        {!svgContent && !loading && !error && (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <span className="text-4xl">📖</span>
            <span className="text-sm">输入一个词汇，看看汉语新解如何解构它</span>
          </div>
        )}
      </div>
    </div>
  );
};
