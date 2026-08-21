import React from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "../Button";

export interface ImagePanelProps {
  apiKey: string; setApiKey(value: string): void; validApiKey: boolean;
  saveApiKey(): void; clearApiKey(): void;
  aspectRatio: string; setAspectRatio(value: string): void;
  prompt: string; setPrompt(value: string): void;
  promptLoading: boolean; hasDocument: boolean; generatePrompt(): void;
  loading: boolean; generate(): void; error: string;
  dataUrl: string; saveAndInsert(): void;
}

export function ImagePanel(p: ImagePanelProps) {
  return <aside className="flex min-h-0 flex-col border-l border-border bg-card">
    <header className="border-b border-border p-4">
      <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />MiniMax 章节插图</div>
      <p className="mt-1 text-xs text-muted-foreground">先生成预览，确认后保存到 assets/images 并插入文章。</p>
    </header>
    <div className="space-y-3 border-b border-border p-4">
      <label className="block text-xs text-muted-foreground">MiniMax API Key
        <input type="password" value={p.apiKey} onChange={(event) => p.setApiKey(event.target.value)} autoComplete="off" placeholder="粘贴完整 API Key" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!p.validApiKey} onClick={p.saveApiKey}><Save className="mr-2 h-4 w-4" />加密保存</Button>
        <Button type="button" size="sm" variant="ghost" onClick={p.clearApiKey}>清除 Key</Button>
      </div>
      <label className="block text-xs text-muted-foreground">画幅
        <select value={p.aspectRatio} onChange={(event) => p.setAspectRatio(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="16:9">横版 16:9</option><option value="4:3">横版 4:3</option><option value="1:1">方形 1:1</option><option value="3:4">竖版 3:4</option><option value="9:16">竖版 9:16</option>
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">插图描述
        <textarea value={p.prompt} onChange={(event) => p.setPrompt(event.target.value)} maxLength={1000} placeholder="描述主体、环境、构图、光线、色彩和艺术风格" className="mt-1 h-28 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" />
      </label>
      <Button type="button" size="sm" variant="outline" className="w-full" disabled={p.promptLoading || !p.hasDocument} onClick={p.generatePrompt}>
        {p.promptLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}依据本文生成插图提示词
      </Button>
      <Button className="w-full" disabled={p.loading || !p.validApiKey || !p.prompt.trim()} onClick={p.generate}>
        {p.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成插图预览
      </Button>
      {p.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{p.error}</div>}
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
      {p.dataUrl ? <img src={p.dataUrl} alt="生成的章节插图预览" className="max-h-full w-full rounded-lg object-contain shadow-sm" /> : <div className="text-center text-xs text-muted-foreground">生成结果将在这里预览。</div>}
    </div>
    <footer className="border-t border-border p-3"><Button className="w-full" disabled={!p.dataUrl || p.loading} onClick={p.saveAndInsert}>保存图片并插入文档末尾</Button></footer>
  </aside>;
}
