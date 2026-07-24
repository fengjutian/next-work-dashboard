/**
 * 内置插件注册 — 将现有面板组件包装为 Plugin 并注册到 registry。
 * 在 App 初始化时调用 registerBuiltInPlugins() 即可。
 */
import { Bot, MessageSquare, History, Network, StickyNote, Puzzle } from 'lucide-react';
import { AIPanel } from '@/components/AIPanel';
import { PromptSidebar } from '@/components/PromptSidebar';
import { ConversationHistory } from '@/components/ConversationHistory';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { NotesPanel } from './notes.plugin';
import { PluginManagerPanel } from './plugin-manager.plugin';
import { pluginRegistry } from '../registry';
import type { Plugin } from '../types';

const builtInPlugins: Plugin[] = [
  {
    id: 'ai',
    name: 'AI',
    icon: Bot,
    component: AIPanel,
    enabled: true,
    order: 0,
  },
  {
    id: 'prompts',
    name: '提示词',
    icon: MessageSquare,
    component: PromptSidebar,
    enabled: true,
    order: 1,
  },
  {
    id: 'history',
    name: '历史',
    icon: History,
    component: ConversationHistory,
    enabled: true,
    order: 2,
  },
  {
    id: 'graph',
    name: '知识图谱',
    icon: Network,
    component: KnowledgeGraph,
    enabled: true,
    order: 3,
  },
  {
    id: 'notes',
    name: '便签',
    icon: StickyNote,
    component: NotesPanel,
    enabled: true,
    order: 4,
  },
  {
    id: 'plugin-manager',
    name: '插件管理',
    icon: Puzzle,
    component: PluginManagerPanel,
    enabled: true,
    order: 5,
  },
];

export function registerBuiltInPlugins(): void {
  pluginRegistry.registerAll(builtInPlugins);
}

export { builtInPlugins };
