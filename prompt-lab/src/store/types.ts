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
    url: 'https://tongyi.aliyun.com/',
    inputSelector: 'textarea[placeholder*="输入"]',
    submitSelector: 'button[class*="send"]',
    enabled: false,
    sortOrder: 3,
  },
];

export const CATEGORIES = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
