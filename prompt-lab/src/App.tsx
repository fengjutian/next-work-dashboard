import React, { useState } from 'react';
import { PanelLeft, PanelRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';

// ── 占位组件 ──

const Sidebar = ({ collapsed }: { collapsed: boolean }) => {
  if (collapsed) return null;

  return (
    <div className="h-full w-[260px] flex-shrink-0 border-r flex flex-col bg-white dark:bg-zinc-950">
      {/* 搜索框 */}
      <div className="p-3">
        <div className="text-sm text-zinc-500 px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-md">
          🔍 搜索提示词...
        </div>
      </div>

      <Separator />

      {/* 分类 */}
      <div className="p-3 border-b">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2">
          分类
        </div>
        {['通用', '编程', '写作', '翻译', '分析'].map((cat) => (
          <div
            key={cat}
            className="px-2 py-1 text-sm rounded-md cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            {cat}
          </div>
        ))}
      </div>

      {/* 提示词列表 */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2">
            提示词
          </div>
          {[
            { title: '代码审查', category: '编程' },
            { title: '翻译成英文', category: '翻译' },
            { title: '总结要点', category: '通用' },
          ].map((p) => (
            <div
              key={p.title}
              className="px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 mb-0.5"
            >
              <div className="text-zinc-800 dark:text-zinc-200">{p.title}</div>
              <div className="text-xs text-zinc-400">{p.category}</div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

const MainContent = () => (
  <div className="flex-1 flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-900">
    <div className="text-center space-y-4">
      <h1 className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">
        PromptLab
      </h1>
      <p className="text-zinc-500">
        AI 提示词注入助手 — 在左侧选择提示词，注入到 AI 网站
      </p>
      <div className="flex gap-2 justify-center">
        {['DeepSeek', 'ChatGPT', 'Kimi'].map((site) => (
          <div
            key={site}
            className="px-4 py-2 rounded-lg border bg-white dark:bg-zinc-800 cursor-pointer hover:border-zinc-400 text-sm"
          >
            + {site}
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ── 根布局 ──

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部工具栏 */}
      <div className="h-10 flex items-center px-3 border-b bg-white dark:bg-zinc-950 gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelRight className="h-4 w-4" />
          )}
        </Button>
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          PromptLab
        </span>
      </div>

      {/* 主体：侧边栏 + 内容区 */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={!sidebarOpen} />
        <MainContent />
      </div>
    </div>
  );
}
