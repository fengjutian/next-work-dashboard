/**
 * 内置插件注册 — 将现有面板组件包装为 Plugin 并注册到 registry。
 * 在 App 初始化时调用 registerBuiltInPlugins() 即可。
 */
import { Bot, MessageSquare, History, Network, StickyNote, Puzzle, BookOpen, Globe } from '@/components/icons';
import { AIPanel } from '@/components/AIPanel';
import { PromptSidebar } from '@/components/PromptSidebar';
import { ConversationHistory } from '@/components/ConversationHistory';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { NotesPanel } from './notes.plugin';
import { PluginManagerPanel } from './plugin-manager.plugin';
import { WereadPanel } from './weread.plugin';
import { WindyPanel } from './windy.plugin';
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
    contributions: {
      commands: [
        { id: 'ai.newTab', title: '打开新标签页', category: 'AI' },
        { id: 'ai.closeTab', title: '关闭当前标签页', category: 'AI' },
      ],
    },
  },
  {
    id: 'prompts',
    name: '提示词',
    icon: MessageSquare,
    component: PromptSidebar,
    enabled: true,
    order: 1,
    contributions: {
      commands: [
        { id: 'prompts.create', title: '新建提示词', category: '提示词' },
        { id: 'prompts.search', title: '搜索提示词', category: '提示词' },
      ],
    },
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
    contributions: {
      commands: [
        { id: 'notes.new', title: '新建便签', category: '便签' },
      ],
    },
  },
  {
    id: 'weread',
    name: '微信读书',
    icon: BookOpen,
    component: WereadPanel,
    enabled: true,
    order: 5,
  },
  {
    id: 'windy',
    name: 'Windy',
    icon: Globe,
    component: WindyPanel,
    enabled: true,
    order: 6,
  },
  {
    id: 'plugin-manager',
    name: '插件管理',
    icon: Puzzle,
    component: PluginManagerPanel,
    enabled: true,
    order: 7,
    contributions: {
      commands: [
        { id: 'plugin-manager.create', title: '新建插件', category: '插件管理' },
        { id: 'plugin-manager.import', title: '导入 .nwd 插件', category: '插件管理' },
      ],
    },
  },
];

export function registerBuiltInPlugins(): void {
  pluginRegistry.registerAll(builtInPlugins);
}

export { builtInPlugins };
