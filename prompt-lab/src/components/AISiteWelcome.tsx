import React from 'react';
import { ArrowRight, Bot, Globe, Settings } from '@/components/icons';
import { useStore } from '@/store';
import type { SiteConfig } from '@/store/types';

const SITE_META: Record<string, { mark: string; description: string; tone: string; group: 'chat' | 'search' }> = {
  deepseek: { mark: 'D', description: '推理、写作与代码', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', group: 'chat' },
  chatgpt: { mark: 'C', description: '通用智能助手', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', group: 'chat' },
  kimi: { mark: 'K', description: '长文本与资料分析', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', group: 'chat' },
  doubao: { mark: '豆', description: '日常问答与创作', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', group: 'chat' },
  gemini: { mark: 'G', description: 'Google AI 助手', tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', group: 'chat' },
  google: { mark: 'G', description: 'Google 网页搜索', tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', group: 'search' },
  bing: { mark: 'B', description: 'Bing 网页搜索', tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', group: 'search' },
  baidu: { mark: '百', description: '百度网页搜索', tone: 'bg-primary/10 text-primary', group: 'search' },
};

export const AISiteWelcome: React.FC = () => {
  const sites = useStore((state) => state.sites);
  const openTab = useStore((state) => state.openTab);
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const enabledSites = [...sites].filter((site) => site.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  const chatSites = enabledSites.filter((site) => SITE_META[site.id]?.group === 'chat');
  const searchSites = enabledSites.filter((site) => SITE_META[site.id]?.group === 'search');
  const otherSites = enabledSites.filter((site) => !SITE_META[site.id]);

  return (
    <div className="flex flex-1 overflow-y-auto bg-background px-6 py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Bot className="h-6 w-6" /></div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">选择 AI 站点</h1>
          <p className="mt-2 text-sm text-muted-foreground">选择一个服务开始对话或搜索</p>
        </div>

        {enabledSites.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center rounded-xl border border-dashed bg-card p-8 text-center">
            <Globe className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">尚未启用任何站点</p>
            <p className="mt-1 text-xs text-muted-foreground">请前往设置启用需要的 AI 或搜索服务。</p>
            <button type="button" className="mt-4 flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary-hover" onClick={() => setActiveActivity('settings')}>
              <Settings className="h-3.5 w-3.5" />打开站点设置
            </button>
          </div>
        ) : (
          <div className="space-y-7">
            <SiteGroup title="AI 对话" description="直接进入 AI 服务" sites={chatSites} onOpen={openTab} />
            <SiteGroup title="搜索服务" description="打开搜索引擎查找资料" sites={searchSites} onOpen={openTab} />
            {otherSites.length > 0 && <SiteGroup title="更多站点" sites={otherSites} onOpen={openTab} />}
          </div>
        )}
      </div>
    </div>
  );
};

const SiteGroup: React.FC<{ title: string; description?: string; sites: SiteConfig[]; onOpen: (siteId: string) => void }> = ({ title, description, sites, onOpen }) => {
  if (sites.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h2>
        {description && <span className="text-[11px] text-muted-foreground">{description}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map((site) => {
          const meta = SITE_META[site.id] ?? { mark: site.name.slice(0, 1).toUpperCase(), description: '打开站点', tone: 'bg-primary/10 text-primary', group: 'chat' as const };
          return (
            <button key={site.id} type="button" className="group flex min-h-20 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(site.id)}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${meta.tone}`}>{meta.mark}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{site.name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{meta.description}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          );
        })}
      </div>
    </section>
  );
};
