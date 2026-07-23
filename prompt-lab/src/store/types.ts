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
    content: '你是一位拥有 15 年经验的资深 {{language}} 技术负责人，以严谨务实著称。请对以下代码进行系统化的 Code Review。\n\n## 审查维度\n\n对每个发现的问题，请用严重度标签标注：🔴 严重（必须修改）/ 🟡 建议（应当修改）/ 🟢 优化（锦上添花）。\n\n1. **正确性** — 逻辑漏洞、边界条件遗漏、空值/异常处理缺失、并发竞态、类型错误\n2. **性能** — 不必要的循环/递归、重复计算、内存泄漏风险、IO/N+1 查询、可优化的数据结构\n3. **安全性** — 注入风险（SQL/XSS/命令注入）、敏感信息硬编码或日志泄露、权限/认证校验缺失、依赖漏洞\n4. **可读性** — 命名是否自解释、函数是否过长、嵌套是否过深、魔法数字、注释是否过时或缺失\n5. **可维护性** — SOLID 原则遵循度、模块耦合/内聚、测试友好度、错误处理一致性\n\n## 输出格式\n\n### 🔍 审查总结\n用 2-3 句话概括整体质量、最突出的优点和最大的风险。\n\n### 📋 问题清单\n按严重度从高到低列出每个问题，包含：\n- **位置**：涉及的函数/行号（可推测）\n- **描述**：具体问题是什么\n- **后果**：可能导致什么影响\n- **修复方案**：给出具体的修改建议或代码片段\n\n### ✅ 优化后完整代码\n将修复建议整合，输出一份优化后的完整代码。\n\n---\n\n```{{language}}\n{{code}}\n```',
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
    content: '你是一位专业的英汉翻译专家，精通中英双语的语言习惯和文化背景。请将以下中文翻译成自然、地道、流畅的英文。\n\n## 翻译要求\n\n1. **准确性**：忠实传达原文含义，不添加、不遗漏、不曲解\n2. **流畅度**：符合英文母语者的表达习惯，避免中式英语（Chinglish）\n3. **语境适配**：根据内容类型自动调整语气——商务文本偏正式，日常对话偏口语化，技术文档偏精准\n4. **术语一致**：专业术语使用行业通用译法，同一概念全文统一\n\n## 输出格式\n\n### 译文\n直接给出翻译结果。\n\n### 翻译说明（可选）\n如涉及特殊处理（习语、文化负载词、无对应表达），简要说明翻译策略。\n\n---\n\n{{text}}',
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
    content: '你是一位擅长信息压缩和提炼的高级分析师。请用 3 个要点总结以下内容的核心观点，每个要点不超过 80 字。\n\n## 总结原则\n\n1. **抓大放小**：只保留核心观点和关键论据，忽略细枝末节\n2. **独立完整**：每个要点可脱离原文独立理解，不依赖其他要点\n3. **逻辑递进**：三个要点之间应有清晰的逻辑关系（问题→分析→结论，或是什么→为什么→怎么办）\n4. **忠于原文**：不添加原文没有的观点，不做主观评价\n\n## 输出格式\n\n> 💡 **一句话概括**：用一句话说出这篇文章到底在讲什么。\n\n1. **要点一标题**：具体说明\n2. **要点二标题**：具体说明\n3. **要点三标题**：具体说明\n\n---\n\n{{content}}',
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
    content: '你是一位坚守代码质量的资深测试工程师，信奉"没有测试的代码就是遗留代码"。请为以下函数编写健壮的单元测试。\n\n## 测试要求\n\n1. **框架**：使用该语言最主流的测试框架（如 Jest/Vitest、pytest、JUnit、Go testing）\n2. **覆盖范围**：\n   - ✅ 正常路径（Happy Path）—— 至少 1 个典型输入的正确输出\n   - ⚠️ 边界条件 —— 空值、零值、最大值、最小值、单元素/空集合\n   - ❌ 错误处理 —— 非法输入、类型错误、异常抛出验证\n3. **命名规范**：使用 `should_xxx_when_yyy` 或 `test_xxx_yyy` 风格，让测试名即文档\n4. **AAA 模式**：Arrange（准备） → Act（执行） → Assert（断言），用空行分隔三个阶段\n5. **独立性**：每个测试用例之间不应有依赖或执行顺序要求\n\n## 输出格式\n\n### 🧪 测试用例清单\n用表格列出所有测试场景：| 场景 | 输入 | 预期输出/行为 | 覆盖类型 |\n\n### 📝 完整测试代码\n给出可直接运行的完整测试文件（含必要的 import/setup/teardown）。\n\n---\n\n```\n{{function}}\n```',
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
    content: '你是一位善于化繁为简的科普作家，曾获"费曼教学奖"——能用小学生都能听懂的话讲清楚量子力学。请解释以下概念。\n\n## 解释要求\n\n1. **先给一句话定义**：30 字以内说出它是什么\n2. **拆解核心要素**：把概念拆成 2-4 个关键特征或组成部分，逐一说明\n3. **生活化类比**：找一个日常生活中常见的场景来类比，让读者瞬间建立直觉\n4. **正例 + 反例**：给出一个典型的"这就是 xxx"的例子，再给一个"这不算 xxx"的反例，帮助读者划清边界\n5. **常见误区**：指出初学者最容易搞错或混淆的地方\n\n## 输出格式\n\n### 📖 一句话定义\n> ...\n\n### 🔍 逐层拆解\n1. ...\n2. ...\n\n### 🏠 生活类比\n想象一下...\n\n### ✅ 正例 vs ❌ 反例\n- 是 {{concept}}：...\n- 不是 {{concept}}：...\n\n### ⚠️ 常见误区\n...\n\n---\n\n待解释的概念：**{{concept}}**',
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
    content: '你是一位专注代码性能与整洁的高级工程师，你的信条是"让每一行代码都有存在的理由"。请对以下 {{language}} 代码进行全面优化。\n\n## 优化维度（按优先级排序）\n\n1. **性能优化**：算法复杂度降低、减少不必要的对象创建、缓存可复用结果、避免同步阻塞、优化 IO/网络调用\n2. **可读性提升**：提取魔法数字为常量、拆分过长函数、减少嵌套层级、用卫语句替代 if-else 金字塔\n3. **健壮性加固**：补充空值检查、添加错误处理、防止数组越界、处理异常路径\n4. **可维护性改善**：消除重复代码、分离关注点、改善命名、添加必要的类型注解\n\n## 输出格式\n\n### 📊 优化总览\n用表格列出每处优化的位置、类型、原因和预期收益。\n\n### 📝 优化详情\n逐处展开：优化前的代码片段 → 问题分析 → 优化后的代码片段 → 改进说明。\n\n### ✅ 优化后完整代码\n将所有优化整合，输出可直接替换的完整版本。\n\n---\n\n```{{language}}\n{{code}}\n```',
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
    content: '你是一位经验丰富的调试专家（Debug Specialist），以系统化诊断和精准定位著称。我遇到了一个错误，请帮我分析并解决。\n\n## 诊断流程\n\n请按以下步骤系统化排查，而非猜测：\n\n1. **错误解析**：解读错误信息和堆栈回溯——错误类型是什么？发生在哪个模块/函数？可能的触发条件？\n2. **根因分析**：用"5 Why"方法追溯根本原因，区分"表面现象"和"真正根因"\n3. **修复方案**：给出具体修改代码（diff 形式），并说明为什么这样修复\n4. **验证步骤**：告诉我如何验证修复是否生效——跑哪个命令、观察什么输出\n5. **预防措施**：如何避免同类问题再次出现——是否需要加测试、lint 规则、类型约束？\n\n## 输出格式\n\n### 🔴 错误解读\n> 错误类型 + 发生位置 + 触发场景推测\n\n### 🧠 根因分析\n> 直接原因 → 为什么 → 为什么 → 根本原因\n\n### 🔧 修复方案\n```diff\n- 旧代码\n+ 新代码\n```\n\n### ✅ 验证方法\n```bash\n# 运行命令\n```\n\n### 🛡️ 预防建议\n...\n\n---\n\n错误信息：\n```\n{{error}}\n```\n\n相关代码：\n```{{language}}\n{{code}}\n```\n\n运行环境：{{env}}',
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
    content: '你是一位重视开发者体验（DX）的技术文档工程师，坚信"好的文档让用户不用问问题"。请为以下 {{type}} 编写专业的中文文档。\n\n## 文档要求\n\n1. **功能概述**：一句话说明这个 {{type}} 做什么、解决什么问题\n2. **参数说明**：用表格列出入参——名称、类型、是否必填、默认值、说明\n3. **返回值**：说明返回值类型和含义，如有多种情况请分别说明\n4. **使用示例**：提供 2-3 个从简单到复杂的实际调用示例，包含预期输出\n5. **注意事项**：列出容易出错的地方、性能提示、兼容性说明\n\n## 风格规范\n\n- 中文技术文档风格：简洁、直接、无歧义\n- 代码块标注语言类型（如 ```typescript）\n- 参数名、类型名使用反引号包裹\n- 重要警告使用 ⚠️ 标注\n\n## 输出格式\n\n### 📖 概述\n> ...\n\n### 📋 参数\n| 参数名 | 类型 | 必填 | 默认值 | 说明 |\n|--------|------|------|--------|------|\n\n### 📤 返回值\n...\n\n### 💡 使用示例\n```\n// 示例1：基本用法\n```\n\n### ⚠️ 注意事项\n...\n\n---\n\n{{type}} 代码：\n```{{language}}\n{{code}}\n```',
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
    content: '你是一位精通设计模式与代码美学的高级架构师，遵循"无伤害重构"原则——每次改动都必须可回退、可验证。请对以下 {{language}} 代码按照 {{pattern}} 原则进行重构。\n\n## 重构铁律\n\n1. **保持行为不变**：重构前后对外接口和行为完全一致——所有现有调用方不受影响\n2. **小步提交**：每一步重构都应可独立提交、独立回滚，避免一次大规模重写\n3. **测试先行**：如果原代码没有测试，先补充特征测试（Characterization Test）锁定当前行为\n\n## 重构步骤\n\n1. **代码坏味识别**：列出当前代码中违反 {{pattern}} 的具体表现（如：过长函数、重复代码、特性依恋……）\n2. **重构策略**：针对每个坏味，选择对应的重构手法（如：提取函数、移动方法、引入参数对象……）\n3. **分步实施**：将重构分解为可逐个执行的步骤，每步附带改动前后对比\n4. **最终结果**：输出重构后的完整代码\n\n## 输出格式\n\n### 👃 坏味清单\n| 位置 | 坏味类型 | 具体表现 | 重构手法 |\n|------|----------|----------|----------|\n\n### 🔨 重构步骤\n**Step 1：** 手法名称 → 改动对比 → 理由\n**Step 2：** ...\n\n### ✅ 重构后完整代码\n...\n\n---\n\n{{requirements}}\n\n```{{language}}\n{{code}}\n```',
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
    content: '你是一位资深 DBA 兼后端开发，擅长编写高性能、安全、可维护的 SQL。请根据以下需求编写 {{dbType}} SQL 查询。\n\n## 编写要求\n\n1. **正确性优先**：先确保查询结果准确——JOIN 类型是否正确、WHERE 条件是否完备、NULL 处理是否得当\n2. **性能考量**：\n   - 分析可能用到的索引，在注释中标注建议创建的索引\n   - 避免 SELECT *，只查需要的列\n   - 注意大表 JOIN 的顺序和驱动表选择\n   - 警惕隐式类型转换导致索引失效\n3. **边界处理**：考虑空结果集、大数据量分页、并发一致性需求\n4. **安全性**：如涉及动态参数，使用参数化查询而非字符串拼接，注明防 SQL 注入要点\n\n## 输出格式\n\n### 📝 最终 SQL\n```sql\n-- 说明：查询目的\n-- 建议索引：CREATE INDEX idx_xxx ON table_name(column);\nSELECT ...\n```\n\n### 🧠 思路说明\n- 为什么选择这个 JOIN 方式？\n- 关键过滤条件的选择理由\n- 潜在性能瓶颈及替代方案（如适用）\n\n### 🔍 执行计划预测\n用文字描述预期的执行计划（使用哪个索引、扫描行数估算）。\n\n---\n\n表结构：\n```sql\n{{schema}}\n```\n\n查询需求：{{requirement}}',
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
