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

// ── 示例提示词 ──

const now = Date.now();
export const DEFAULT_PROMPTS: Prompt[] = [
  {
    id: 'p1',
    title: '代码审查',
    content: '请对以下代码进行审查，指出潜在问题（性能、安全、可读性），并给出改进建议：\n\n```\n{{code}}\n```',
    category: '编程',
    tags: ['代码', '审查'],
    variables: [{ name: 'code', defaultValue: '', description: '待审查的代码' }],
    isFavorite: true,
    isPinned: true,
    usageCount: 5,
    createdAt: now - 86400000,
    updatedAt: now,
  },
  {
    id: 'p2',
    title: '翻译成英文',
    content: '请将以下中文翻译成自然流畅的英文：\n\n{{text}}',
    category: '翻译',
    tags: ['翻译', '英文'],
    variables: [{ name: 'text', defaultValue: '', description: '待翻译的中文' }],
    isFavorite: true,
    isPinned: false,
    usageCount: 12,
    createdAt: now - 86400000 * 2,
    updatedAt: now,
  },
  {
    id: 'p3',
    title: '总结要点',
    content: '请用 3 个要点总结以下内容的核心观点：\n\n{{content}}',
    category: '通用',
    tags: ['总结'],
    variables: [{ name: 'content', defaultValue: '', description: '待总结的内容' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 3,
    createdAt: now - 86400000 * 3,
    updatedAt: now,
  },
  {
    id: 'p4',
    title: '写单元测试',
    content: '为以下函数编写健壮的单元测试，覆盖正常路径、边界条件和错误处理：\n\n```\n{{function}}\n```',
    category: '编程',
    tags: ['测试', '代码'],
    variables: [{ name: 'function', defaultValue: '', description: '待测试的函数代码' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 4,
    updatedAt: now,
  },
  {
    id: 'p5',
    title: '解释概念',
    content: '请用通俗易懂的语言解释"{{concept}}"，并给出一个生活中的类比帮助理解。',
    category: '通用',
    tags: ['解释'],
    variables: [{ name: 'concept', defaultValue: '', description: '待解释的概念' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 2,
    createdAt: now - 86400000 * 5,
    updatedAt: now,
  },
];

export const CATEGORIES = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
