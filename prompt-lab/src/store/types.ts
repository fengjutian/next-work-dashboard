// ── 数据模型（与 drizzle schema 对齐，但用于 UI 层）──

export interface PromptVariable {
  name: string;
  defaultValue: string;
  description: string;
}

export interface Prompt {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  variables: PromptVariable[];
  isFavorite: boolean;
  isPinned: boolean;
  /** 是否启用，未设置时默认为 true */
  enabled?: boolean;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  inputSelector: string;
  submitSelector: string;
  enabled: boolean;
  sortOrder: number;
  /** API URL 模式，用于网络拦截捕获对话数据（正则字符串） */
  apiPatterns?: string[];
}

export interface Tab {
  id: string;
  siteId: string;
  title: string;
  url: string;
}

export type InjectMode = 'fill-only' | 'fill-and-submit';
export type InjectStrategy = 'replace' | 'append';

// ── 预设站点 ──

export const DEFAULT_SITES: SiteConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    inputSelector: 'textarea[placeholder*="发送"]',
    submitSelector: 'div[role="button"][class*="send"]',
    enabled: true,
    sortOrder: 0,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    inputSelector: '#prompt-textarea',
    submitSelector: 'button[data-testid="send-button"]',
    enabled: true,
    sortOrder: 1,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    inputSelector: 'textarea[placeholder*="问"]',
    submitSelector: 'button[class*="send"]',
    enabled: true,
    sortOrder: 2,
  },
  {
    id: 'tongyi',
    name: '通义千问',
    url: 'https://www.qianwen.com/?source=tongyigw',
    inputSelector: 'textarea[placeholder*="输入"]',
    submitSelector: 'button[class*="send"]',
    enabled: false,
    sortOrder: 3,
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    inputSelector: 'textarea[placeholder*="发消息"]',
    submitSelector: 'button[class*="send"]',
    enabled: true,
    sortOrder: 4,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    inputSelector: 'div[contenteditable="true"]',
    submitSelector: 'button[aria-label*="Send"]',
    enabled: true,
    sortOrder: 5,
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://www.google.com/',
    inputSelector: 'textarea[name="q"], input[name="q"]',
    submitSelector: '',
    enabled: true,
    sortOrder: 6,
  },
  {
    id: 'bing',
    name: 'Bing',
    url: 'https://www.bing.com/',
    inputSelector: 'input[name="q"], #sb_form_q',
    submitSelector: '',
    enabled: true,
    sortOrder: 7,
  },
  {
    id: 'baidu',
    name: '百度',
    url: 'https://www.baidu.com/',
    inputSelector: 'input[name="wd"], #kw',
    submitSelector: '',
    enabled: true,
    sortOrder: 8,
  },
  {
    id: 'zhihu',
    name: '知乎搜索',
    url: 'https://zhihu.sogou.com/',
    inputSelector: 'input[name="query"], #query',
    submitSelector: '',
    enabled: true,
    sortOrder: 9,
  },
];

export type AiApiProvider = 'deepseek' | 'qwen' | 'minimax' | 'custom';

export interface AiApiConfig {
  provider: AiApiProvider;
  qwenPlan?: 'payg' | 'token-plan';
  apiKey: string;
  model: string;
  baseUrl: string;
  providerApiKeys?: Partial<Record<AiApiProvider, string>>;
}

export interface LlmCacheConfig {
  enabled: boolean;
  semanticShadowEnabled: boolean;
  ttlHours: number;
  maxEntries: number;
}

export interface MemoryConfig {
  provider: 'local' | 'openai';
  contextBudget: number;
  recallCount: number;
  minScore: number;
  maxPerDocument: number;
  autoIndex: boolean;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  localEmbeddingEnabled: boolean;
  localEmbeddingModel: string;
  tencentDbEnabled: boolean;
  tencentDbBaseUrl: string;
  tencentDbServiceId: string;
  tencentDbUserKey: string;
}

/**
 * 角色 Agent 定义 — 预定义人物设定和工具权限
 */
export interface Role {
  id: string;
  name: string;
  description: string;
  /** 角色系统提示词 — 定义行为、风格、知识边界 */
  systemPrompt: string;
  /** 允许使用的工具 ID 列表，空数组表示允许所有工具 */
  enabledToolIds: string[];
  createdAt: number;
  updatedAt: number;
}

export const CATEGORIES = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
