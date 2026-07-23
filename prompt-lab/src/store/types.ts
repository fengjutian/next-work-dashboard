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
    content: '你是一位资深 {{language}} 开发专家，请对以下代码进行全面审查，按以下维度逐项分析并给出改进建议：\n\n1. **正确性** — 逻辑是否正确，边界条件和异常情况是否处理到位\n2. **性能** — 是否存在不必要的计算、内存分配、IO 或算法复杂度问题\n3. **安全性** — 是否存在注入风险、敏感信息泄露、权限校验缺失等问题\n4. **可读性** — 命名是否清晰、结构是否合理、注释是否恰当\n5. **可维护性** — 是否符合 SOLID 原则，模块耦合度是否过高\n\n对每个问题请用 🔴严重 / 🟡建议 / 🟢优化 标注严重程度，并在最后给出优化后的完整代码。\n\n```{{language}}\n{{code}}\n```',
    category: '编程',
    tags: ['代码', '审查'],
    variables: [
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待审查的代码' },
    ],
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
  {
    id: 'p6',
    title: '优化代码',
    content: '请优化以下代码，提升性能、可读性和可维护性，并说明每处优化的理由：\n\n```{{language}}\n{{code}}\n```',
    category: '编程',
    tags: ['优化', '代码'],
    variables: [
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待优化的代码' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 6,
    updatedAt: now,
  },
  {
    id: 'p7',
    title: '调试错误',
    content: '我遇到了以下错误信息，请帮我分析原因并给出修复方案：\n\n错误信息：\n```\n{{error}}\n```\n\n相关代码：\n```{{language}}\n{{code}}\n```\n\n环境：{{env}}',
    category: '编程',
    tags: ['调试', '错误'],
    variables: [
      { name: 'error', defaultValue: '', description: '错误信息/堆栈' },
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '相关代码片段' },
      { name: 'env', defaultValue: '', description: '运行环境（如 Node 20, Chrome 等）' },
    ],
    isFavorite: true,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 7,
    updatedAt: now,
  },
  {
    id: 'p8',
    title: '编写文档',
    content: '请为以下 {{type}} 编写清晰的中文文档，包含功能说明、参数列表、返回值和使用示例：\n\n```{{language}}\n{{code}}\n```',
    category: '编程',
    tags: ['文档', '注释'],
    variables: [
      { name: 'type', defaultValue: '函数', description: '文档类型（函数/类/模块/API）' },
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待文档化的代码' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 8,
    updatedAt: now,
  },
  {
    id: 'p9',
    title: '重构代码',
    content: '请对以下代码进行重构，遵循 {{pattern}} 设计模式 / 最佳实践，保持原有功能不变：\n\n```{{language}}\n{{code}}\n```\n\n额外要求：{{requirements}}',
    category: '编程',
    tags: ['重构', '设计模式'],
    variables: [
      { name: 'pattern', defaultValue: 'SOLID', description: '目标模式或原则' },
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待重构的代码' },
      { name: 'requirements', defaultValue: '', description: '额外要求' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 9,
    updatedAt: now,
  },
  {
    id: 'p10',
    title: 'SQL 查询',
    content: '请根据以下需求编写 {{dbType}} SQL 查询，确保考虑索引优化和边界条件：\n\n表结构：\n```sql\n{{schema}}\n```\n\n查询需求：{{requirement}}',
    category: '编程',
    tags: ['SQL', '数据库'],
    variables: [
      { name: 'dbType', defaultValue: 'MySQL', description: '数据库类型' },
      { name: 'schema', defaultValue: '', description: '表结构 DDL' },
      { name: 'requirement', defaultValue: '', description: '查询需求描述' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: now - 86400000 * 10,
    updatedAt: now,
  },
];

export const CATEGORIES = ['通用', '编程', '写作', '翻译', '分析', '设计', '营销'];
