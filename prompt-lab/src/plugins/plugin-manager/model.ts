import type { Plugin } from '../types';

export type PluginCategoryId = 'ai' | 'knowledge' | 'office' | 'development' | 'productivity' | 'system' | 'custom';
export type PluginStatusFilter = 'all' | 'enabled' | 'disabled';

export interface PluginCategory {
  id: PluginCategoryId;
  label: string;
  description: string;
}

export interface CategorizedPlugins extends PluginCategory {
  plugins: Plugin[];
}

export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { id: 'ai', label: 'AI 与创作', description: 'AI 会话、提示词和内容创作' },
  { id: 'knowledge', label: '知识管理', description: '知识库、图谱、阅读和文档检索' },
  { id: 'office', label: '办公文档', description: 'Office、PDF、白板与文本处理' },
  { id: 'development', label: '开发工具', description: '代码、终端、数据库与系统分析' },
  { id: 'productivity', label: '效率服务', description: '便签、翻译、天气和语言学习' },
  { id: 'system', label: '系统组件', description: '工作台自身的管理能力' },
  { id: 'custom', label: '自定义插件', description: '导入或创建的 Sandbox 插件' },
];

const BUILT_IN_CATEGORY: Record<string, PluginCategoryId> = {
  ai: 'ai', chat: 'ai', prompts: 'ai', 'style-image': 'ai',
  history: 'knowledge', graph: 'knowledge', weread: 'knowledge', 'document-knowledge': 'knowledge', 'product-spec': 'knowledge',
  'office-studio': 'office', 'word-preview': 'office', 'excel-preview': 'office', 'ppt-preview': 'office',
  'pdf-preview': 'office', excalidraw: 'office', compare: 'office',
  'code-editor': 'development', terminal: 'development', database: 'development', 'disk-space': 'development',
  'screen-capture': 'productivity', notes: 'productivity', translator: 'productivity', windy: 'productivity',
  'hanyu-jinjie': 'productivity', lingohut: 'productivity',
  'plugin-manager': 'system',
};

export function pluginCategory(id: string, isUserPlugin: boolean): PluginCategoryId {
  return isUserPlugin ? 'custom' : BUILT_IN_CATEGORY[id] ?? 'system';
}

export function categorizePlugins(plugins: Plugin[], userPluginIds: ReadonlySet<string>): CategorizedPlugins[] {
  return PLUGIN_CATEGORIES.map((category) => ({
    ...category,
    plugins: plugins.filter((plugin) => pluginCategory(plugin.id, userPluginIds.has(plugin.id)) === category.id),
  })).filter((category) => category.plugins.length > 0);
}

export function filterPluginCategories(
  categories: CategorizedPlugins[],
  options: { category: 'all' | PluginCategoryId; status: PluginStatusFilter; query: string },
): CategorizedPlugins[] {
  const query = options.query.trim().toLocaleLowerCase();

  return categories
    .filter((category) => options.category === 'all' || category.id === options.category)
    .map((category) => ({
      ...category,
      plugins: category.plugins.filter((plugin) => {
        const matchesStatus = options.status === 'all'
          || (options.status === 'enabled' ? plugin.enabled : !plugin.enabled);
        const matchesQuery = !query
          || plugin.name.toLocaleLowerCase().includes(query)
          || plugin.id.toLocaleLowerCase().includes(query);
        return matchesStatus && matchesQuery;
      }),
    }))
    .filter((category) => category.plugins.length > 0);
}
