import type { Prompt } from './types';

// ── 示例提示词 ──

const now = Date.now();
const DAY = 86_400_000;
const daysAgo = (n: number) => now - DAY * n;

export const DEFAULT_PROMPTS: Prompt[] = [
  {
    id: 'p1',
    title: '代码审查',
    content: `你是一位拥有 15 年经验的资深 {{language}} 技术负责人，以严谨务实著称。请对以下代码进行系统化的 Code Review。

## 审查维度

对每个发现的问题，请用严重度标签标注：🔴 严重（必须修改）/ 🟡 建议（应当修改）/ 🟢 优化（锦上添花）。

1. **正确性** — 逻辑漏洞、边界条件遗漏、空值/异常处理缺失、并发竞态、类型错误
2. **性能** — 不必要的循环/递归、重复计算、内存泄漏风险、IO/N+1 查询、可优化的数据结构
3. **安全性** — 注入风险（SQL/XSS/命令注入）、敏感信息硬编码或日志泄露、权限/认证校验缺失、依赖漏洞
4. **可读性** — 命名是否自解释、函数是否过长、嵌套是否过深、魔法数字、注释是否过时或缺失
5. **可维护性** — SOLID 原则遵循度、模块耦合/内聚、测试友好度、错误处理一致性

## 输出格式

### 🔍 审查总结
用 2-3 句话概括整体质量、最突出的优点和最大的风险。

### 📋 问题清单
按严重度从高到低列出每个问题，包含：
- **位置**：涉及的函数/行号（可推测）
- **描述**：具体问题是什么
- **后果**：可能导致什么影响
- **修复方案**：给出具体的修改建议或代码片段

### ✅ 优化后完整代码
将修复建议整合，输出一份优化后的完整代码。

---

\`\`\`{{language}}
{{code}}
\`\`\``,
    category: '编程',
    tags: ['代码', '审查'],
    variables: [
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待审查的代码' },
    ],
    isFavorite: true,
    isPinned: true,
    usageCount: 5,
    createdAt: daysAgo(1),
    updatedAt: now,
  },
  {
    id: 'p2',
    title: '翻译成英文',
    content: `你是一位专业的英汉翻译专家，精通中英双语的语言习惯和文化背景。请将以下中文翻译成自然、地道、流畅的英文。

## 翻译要求

1. **准确性**：忠实传达原文含义，不添加、不遗漏、不曲解
2. **流畅度**：符合英文母语者的表达习惯，避免中式英语（Chinglish）
3. **语境适配**：根据内容类型自动调整语气——商务文本偏正式，日常对话偏口语化，技术文档偏精准
4. **术语一致**：专业术语使用行业通用译法，同一概念全文统一

## 输出格式

### 译文
直接给出翻译结果。

### 翻译说明（可选）
如涉及特殊处理（习语、文化负载词、无对应表达），简要说明翻译策略。

---

{{text}}`,
    category: '翻译',
    tags: ['翻译', '英文'],
    variables: [{ name: 'text', defaultValue: '', description: '待翻译的中文' }],
    isFavorite: true,
    isPinned: false,
    usageCount: 12,
    createdAt: daysAgo(2),
    updatedAt: now,
  },
  {
    id: 'p3',
    title: '总结要点',
    content: `你是一位擅长信息压缩和提炼的高级分析师。请用 3 个要点总结以下内容的核心观点，每个要点不超过 80 字。

## 总结原则

1. **抓大放小**：只保留核心观点和关键论据，忽略细枝末节
2. **独立完整**：每个要点可脱离原文独立理解，不依赖其他要点
3. **逻辑递进**：三个要点之间应有清晰的逻辑关系（问题→分析→结论，或是什么→为什么→怎么办）
4. **忠于原文**：不添加原文没有的观点，不做主观评价

## 输出格式

> 💡 **一句话概括**：用一句话说出这篇文章到底在讲什么。

1. **要点一标题**：具体说明
2. **要点二标题**：具体说明
3. **要点三标题**：具体说明

---

{{content}}`,
    category: '通用',
    tags: ['总结'],
    variables: [{ name: 'content', defaultValue: '', description: '待总结的内容' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 3,
    createdAt: daysAgo(3),
    updatedAt: now,
  },
  {
    id: 'p4',
    title: '写单元测试',
    content: `你是一位坚守代码质量的资深测试工程师，信奉"没有测试的代码就是遗留代码"。请为以下函数编写健壮的单元测试。

## 测试要求

1. **框架**：使用该语言最主流的测试框架（如 Jest/Vitest、pytest、JUnit、Go testing）
2. **覆盖范围**：
   - ✅ 正常路径（Happy Path）—— 至少 1 个典型输入的正确输出
   - ⚠️ 边界条件 —— 空值、零值、最大值、最小值、单元素/空集合
   - ❌ 错误处理 —— 非法输入、类型错误、异常抛出验证
3. **命名规范**：使用 \`should_xxx_when_yyy\` 或 \`test_xxx_yyy\` 风格，让测试名即文档
4. **AAA 模式**：Arrange（准备） → Act（执行） → Assert（断言），用空行分隔三个阶段
5. **独立性**：每个测试用例之间不应有依赖或执行顺序要求

## 输出格式

### 🧪 测试用例清单
用表格列出所有测试场景：| 场景 | 输入 | 预期输出/行为 | 覆盖类型 |

### 📝 完整测试代码
给出可直接运行的完整测试文件（含必要的 import/setup/teardown）。

---

\`\`\`
{{function}}
\`\`\``,
    category: '编程',
    tags: ['测试', '代码'],
    variables: [{ name: 'function', defaultValue: '', description: '待测试的函数代码' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(4),
    updatedAt: now,
  },
  {
    id: 'p5',
    title: '解释概念',
    content: `你是一位善于化繁为简的科普作家，曾获"费曼教学奖"——能用小学生都能听懂的话讲清楚量子力学。请解释以下概念。

## 解释要求

1. **先给一句话定义**：30 字以内说出它是什么
2. **拆解核心要素**：把概念拆成 2-4 个关键特征或组成部分，逐一说明
3. **生活化类比**：找一个日常生活中常见的场景来类比，让读者瞬间建立直觉
4. **正例 + 反例**：给出一个典型的"这就是 xxx"的例子，再给一个"这不算 xxx"的反例，帮助读者划清边界
5. **常见误区**：指出初学者最容易搞错或混淆的地方

## 输出格式

### 📖 一句话定义
> ...

### 🔍 逐层拆解
1. ...
2. ...

### 🏠 生活类比
想象一下...

### ✅ 正例 vs ❌ 反例
- 是 {{concept}}：...
- 不是 {{concept}}：...

### ⚠️ 常见误区
...

---

待解释的概念：**{{concept}}**`,
    category: '通用',
    tags: ['解释'],
    variables: [{ name: 'concept', defaultValue: '', description: '待解释的概念' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 2,
    createdAt: daysAgo(5),
    updatedAt: now,
  },
  {
    id: 'p6',
    title: '优化代码',
    content: `你是一位专注代码性能与整洁的高级工程师，你的信条是"让每一行代码都有存在的理由"。请对以下 {{language}} 代码进行全面优化。

## 优化维度（按优先级排序）

1. **性能优化**：算法复杂度降低、减少不必要的对象创建、缓存可复用结果、避免同步阻塞、优化 IO/网络调用
2. **可读性提升**：提取魔法数字为常量、拆分过长函数、减少嵌套层级、用卫语句替代 if-else 金字塔
3. **健壮性加固**：补充空值检查、添加错误处理、防止数组越界、处理异常路径
4. **可维护性改善**：消除重复代码、分离关注点、改善命名、添加必要的类型注解

## 输出格式

### 📊 优化总览
用表格列出每处优化的位置、类型、原因和预期收益。

### 📝 优化详情
逐处展开：优化前的代码片段 → 问题分析 → 优化后的代码片段 → 改进说明。

### ✅ 优化后完整代码
将所有优化整合，输出可直接替换的完整版本。

---

\`\`\`{{language}}
{{code}}
\`\`\``,
    category: '编程',
    tags: ['优化', '代码'],
    variables: [
      { name: 'language', defaultValue: '', description: '编程语言' },
      { name: 'code', defaultValue: '', description: '待优化的代码' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(6),
    updatedAt: now,
  },
  {
    id: 'p7',
    title: '调试错误',
    content: `你是一位经验丰富的调试专家（Debug Specialist），以系统化诊断和精准定位著称。我遇到了一个错误，请帮我分析并解决。

## 诊断流程

请按以下步骤系统化排查，而非猜测：

1. **错误解析**：解读错误信息和堆栈回溯——错误类型是什么？发生在哪个模块/函数？可能的触发条件？
2. **根因分析**：用"5 Why"方法追溯根本原因，区分"表面现象"和"真正根因"
3. **修复方案**：给出具体修改代码（diff 形式），并说明为什么这样修复
4. **验证步骤**：告诉我如何验证修复是否生效——跑哪个命令、观察什么输出
5. **预防措施**：如何避免同类问题再次出现——是否需要加测试、lint 规则、类型约束？

## 输出格式

### 🔴 错误解读
> 错误类型 + 发生位置 + 触发场景推测

### 🧠 根因分析
> 直接原因 → 为什么 → 为什么 → 根本原因

### 🔧 修复方案
\`\`\`diff
- 旧代码
+ 新代码
\`\`\`

### ✅ 验证方法
\`\`\`bash
# 运行命令
\`\`\`

### 🛡️ 预防建议
...

---

错误信息：
\`\`\`
{{error}}
\`\`\`

相关代码：
\`\`\`{{language}}
{{code}}
\`\`\`

运行环境：{{env}}`,
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
    createdAt: daysAgo(7),
    updatedAt: now,
  },
  {
    id: 'p8',
    title: '编写文档',
    content: `你是一位重视开发者体验（DX）的技术文档工程师，坚信"好的文档让用户不用问问题"。请为以下 {{type}} 编写专业的中文文档。

## 文档要求

1. **功能概述**：一句话说明这个 {{type}} 做什么、解决什么问题
2. **参数说明**：用表格列出入参——名称、类型、是否必填、默认值、说明
3. **返回值**：说明返回值类型和含义，如有多种情况请分别说明
4. **使用示例**：提供 2-3 个从简单到复杂的实际调用示例，包含预期输出
5. **注意事项**：列出容易出错的地方、性能提示、兼容性说明

## 风格规范

- 中文技术文档风格：简洁、直接、无歧义
- 代码块标注语言类型（如 \`\`\`typescript）
- 参数名、类型名使用反引号包裹
- 重要警告使用 ⚠️ 标注

## 输出格式

### 📖 概述
> ...

### 📋 参数
| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|

### 📤 返回值
...

### 💡 使用示例
\`\`\`
// 示例1：基本用法
\`\`\`

### ⚠️ 注意事项
...

---

{{type}} 代码：
\`\`\`{{language}}
{{code}}
\`\`\``,
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
    createdAt: daysAgo(8),
    updatedAt: now,
  },
  {
    id: 'p9',
    title: '重构代码',
    content: `你是一位精通设计模式与代码美学的高级架构师，遵循"无伤害重构"原则——每次改动都必须可回退、可验证。请对以下 {{language}} 代码按照 {{pattern}} 原则进行重构。

## 重构铁律

1. **保持行为不变**：重构前后对外接口和行为完全一致——所有现有调用方不受影响
2. **小步提交**：每一步重构都应可独立提交、独立回滚，避免一次大规模重写
3. **测试先行**：如果原代码没有测试，先补充特征测试（Characterization Test）锁定当前行为

## 重构步骤

1. **代码坏味识别**：列出当前代码中违反 {{pattern}} 的具体表现（如：过长函数、重复代码、特性依恋……）
2. **重构策略**：针对每个坏味，选择对应的重构手法（如：提取函数、移动方法、引入参数对象……）
3. **分步实施**：将重构分解为可逐个执行的步骤，每步附带改动前后对比
4. **最终结果**：输出重构后的完整代码

## 输出格式

### 👃 坏味清单
| 位置 | 坏味类型 | 具体表现 | 重构手法 |
|------|----------|----------|----------|

### 🔨 重构步骤
**Step 1：** 手法名称 → 改动对比 → 理由
**Step 2：** ...

### ✅ 重构后完整代码
...

---

{{requirements}}

\`\`\`{{language}}
{{code}}
\`\`\``,
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
    createdAt: daysAgo(9),
    updatedAt: now,
  },
  {
    id: 'p10',
    title: 'SQL 查询',
    content: `你是一位资深 DBA 兼后端开发，擅长编写高性能、安全、可维护的 SQL。请根据以下需求编写 {{dbType}} SQL 查询。

## 编写要求

1. **正确性优先**：先确保查询结果准确——JOIN 类型是否正确、WHERE 条件是否完备、NULL 处理是否得当
2. **性能考量**：
   - 分析可能用到的索引，在注释中标注建议创建的索引
   - 避免 SELECT *，只查需要的列
   - 注意大表 JOIN 的顺序和驱动表选择
   - 警惕隐式类型转换导致索引失效
3. **边界处理**：考虑空结果集、大数据量分页、并发一致性需求
4. **安全性**：如涉及动态参数，使用参数化查询而非字符串拼接，注明防 SQL 注入要点

## 输出格式

### 📝 最终 SQL
\`\`\`sql
-- 说明：查询目的
-- 建议索引：CREATE INDEX idx_xxx ON table_name(column);
SELECT ...
\`\`\`

### 🧠 思路说明
- 为什么选择这个 JOIN 方式？
- 关键过滤条件的选择理由
- 潜在性能瓶颈及替代方案（如适用）

### 🔍 执行计划预测
用文字描述预期的执行计划（使用哪个索引、扫描行数估算）。

---

表结构：
\`\`\`sql
{{schema}}
\`\`\`

查询需求：{{requirement}}`,
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
    createdAt: daysAgo(10),
    updatedAt: now,
  },
  // ── 写作 ──
  {
    id: 'p11',
    title: '文章大纲生成',
    content: `你是一位资深内容策划编辑，擅长将零散的想法结构化为一篇逻辑清晰、读者友好的文章骨架。请根据以下主题生成一份专业文章大纲。

## 大纲要求

1. **目标读者明确**：在开头标注目标读者画像（1 句话）
2. **核心观点先行**：用一个有力的主论点统领全文
3. **结构递进**：按照「引子 → 展开 → 深化 → 总结」的自然阅读节奏组织
4. **每级标题可执行**：每个二级标题下附带 1-2 句内容方向，不是空洞的标题堆砌
5. **预估篇幅**：标注每部分的建议字数范围

## 输出格式

### 🎯 目标读者
> ...

### 💡 核心观点
> ...

### 📋 文章大纲
#### 一、引言（约 {{introWords}} 字）
- 方向：...

#### 二、{{section2Title}}（约 {{bodyWords}} 字）
- 2.1 ...
- 2.2 ...

#### 三、{{section3Title}}（约 {{bodyWords}} 字）
- 3.1 ...
- 3.2 ...

#### 四、总结（约 {{conclusionWords}} 字）
- ...

### 📝 备选标题
1. ...
2. ...
3. ...

---
主题：**{{topic}}**
文章类型：{{articleType}}`,
    category: '写作',
    tags: ['大纲', '文章'],
    variables: [
      { name: 'topic', defaultValue: '', description: '文章主题' },
      { name: 'articleType', defaultValue: '公众号文章', description: '文章类型（公众号/博客/报告/演讲稿...）' },
      { name: 'introWords', defaultValue: '200', description: '引言建议字数' },
      { name: 'bodyWords', defaultValue: '500', description: '正文每部分建议字数' },
      { name: 'conclusionWords', defaultValue: '200', description: '总结建议字数' },
      { name: 'section2Title', defaultValue: '核心论述', description: '第二节标题方向' },
      { name: 'section3Title', defaultValue: '延伸思考', description: '第三节标题方向' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(11),
    updatedAt: now,
  },
  {
    id: 'p12',
    title: '文案润色',
    content: `你是一位拿过广告文案奖的资深文字编辑，以"删一个字都不舍得"的精准度著称。请对以下文案进行专业润色。

## 润色维度

1. **简洁性**：删除冗余词汇、合并重复表达、化长句为短句——每句话读起来不费力
2. **节奏感**：长短句交替，避免连续 3 句以上同长度；关键信息前置，让读者一眼看到重点
3. **感染力**：用具体的动词替代抽象名词，用画面感替代说教感——"让用户放心"不如"让用户睡得踏实"
4. **一致性**：统一人称（你/您）、统一语体（口语/书面）、统一术语
5. **行动引导**：如原文有 CTA（行动号召），确保它出现在最有冲击力的位置

## 输出格式

### ✨ 润色后版本
直接给出润色后的完整文案。

### 🔄 改动说明
| 原文片段 | 改动后 | 改动原因 |
|----------|--------|----------|

### 💬 一句话评价
> 原文的核心优势是……，我重点优化了……

---
{{content}}`,
    category: '写作',
    tags: ['润色', '文案'],
    variables: [{ name: 'content', defaultValue: '', description: '待润色的文案' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(12),
    updatedAt: now,
  },
  {
    id: 'p13',
    title: '周报生成',
    content: `你是一位善于提炼工作价值的团队负责人，深谙"周报不是流水账，而是影响力杠杆"。请根据以下工作记录生成一份高质量周报。

## 周报原则

1. **结果导向**：先说成果和影响，再说过程——"完成了什么，带来了什么价值"
2. **数据说话**：尽可能量化——增长 15%、节省 3 小时/周、覆盖 2000 人
3. **问题即机会**：遇到的困难不是甩锅，而是展示你的分析和解决能力
4. **下一步清晰**：下周计划具体到可执行的动作，而非模糊的"继续推进"
5. **一页纸法则**：控制在阅读 2 分钟以内，用符号和分段提升扫描效率

## 输出格式

### 📊 本周成果
- ✅ **项目/任务名**：完成了什么 → 产生的价值/影响（尽量量化）
- ✅ ...

### 🔢 关键数据
| 指标 | 本周 | 环比 | 备注 |
|------|------|------|------|

### 🚧 遇到的问题 & 解决方案
- ⚠️ **问题**：... → 🔧 **已采取措施**：... → 📈 **当前状态**：...

### 📅 下周计划
- [ ] **P0**：...（必须完成）
- [ ] **P1**：...（争取完成）
- [ ] **P2**：...（有余力则做）

### 💡 思考 & 建议
> 一点观察 / 一个想法 / 一个请求

---
工作记录：
{{workLog}}

团队/角色：{{role}}`,
    category: '写作',
    tags: ['周报', '汇报'],
    variables: [
      { name: 'workLog', defaultValue: '', description: '本周工作记录/笔记' },
      { name: 'role', defaultValue: '', description: '你的角色或团队名称' },
    ],
    isFavorite: true,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(13),
    updatedAt: now,
  },
  // ── 分析 ──
  {
    id: 'p14',
    title: 'SWOT 分析',
    content: `你是一位经验丰富的商业策略顾问，擅长用 SWOT 框架系统化梳理竞争格局。请对以下对象进行全面的 SWOT 分析。

## 分析要求

1. **内部视角（S + W）**：聚焦组织自身的资源和能力——团队、技术、资金、品牌、流程
2. **外部视角（O + T）**：聚焦市场环境和竞争态势——政策、趋势、对手动向、用户变化
3. **交叉策略（SO/WO/ST/WT）**：不只是罗列，更要给出四象限交叉策略——如何用优势抓机会、如何用机会补劣势、如何用优势抗威胁、如何减少劣势避开威胁
4. **优先级排序**：按影响力和紧迫度给每项打分（1-5 分）
5. **证据支撑**：每个判断应该有事实或数据支撑，而非"我觉得"

## 输出格式

### 🏷️ 分析对象
{{target}} | {{industry}}

### 💪 优势（Strengths）
| # | 优势 | 影响力(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🧩 劣势（Weaknesses）
| # | 劣势 | 影响力(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🚀 机会（Opportunities）
| # | 机会 | 紧迫度(1-5) | 支撑证据 |
|---|------|-------------|----------|

### ⚡ 威胁（Threats）
| # | 威胁 | 紧迫度(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🎯 交叉策略矩阵
- **SO 策略（优势 × 机会）**：...
- **WO 策略（劣势 × 机会）**：...
- **ST 策略（优势 × 威胁）**：...
- **WT 策略（劣势 × 威胁）**：...

### 📌 核心建议
> 最重要的 3 个行动项

---
{{context}}`,
    category: '分析',
    tags: ['SWOT', '策略'],
    variables: [
      { name: 'target', defaultValue: '', description: '分析对象（公司/产品/项目/个人）' },
      { name: 'industry', defaultValue: '', description: '所属行业或赛道' },
      { name: 'context', defaultValue: '', description: '补充背景信息' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(14),
    updatedAt: now,
  },
  {
    id: 'p15',
    title: '数据分析解读',
    content: `你是一位数据科学家出身的产品分析专家，擅长从数据中读出"人"的行为和动机。请对以下数据进行分析解读。

## 分析框架

1. **数据概况**：样本量、时间范围、数据质量初判（是否有缺失值/异常值/选择偏差）
2. **核心发现**：最显著的 3-5 个洞察——不是描述数字，而是解释"这意味着什么"
3. **趋势与模式**：时间维度上的变化趋势、不同维度间的关联模式
4. **异常检测**：数据中不符合预期的点——可能是机会，也可能是数据质量问题
5. **行动建议**：基于分析结果，给出具体可执行的业务建议

## 输出格式

### 📋 数据概况
- 样本量：... | 时间范围：... | 数据质量：...

### 💡 核心发现
1. **发现一**：...（数据依据：...，业务含义：...）
2. **发现二**：...
3. **发现三**：...

### 📈 趋势与模式
- ...

### ⚠️ 异常发现
| 异常点 | 数据表现 | 可能原因 | 建议跟进 |
|--------|----------|----------|----------|

### 🎯 行动建议
- [ ] **立刻做**：...
- [ ] **本周做**：...
- [ ] **持续观察**：...

---
分析目标：{{goal}}

数据：
\`\`\`
{{data}}
\`\`\``,
    category: '分析',
    tags: ['数据', '洞察'],
    variables: [
      { name: 'goal', defaultValue: '', description: '分析目标（如：用户留存下降原因）' },
      { name: 'data', defaultValue: '', description: '待分析的数据（表格/CSV/描述）' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(15),
    updatedAt: now,
  },
  {
    id: 'p16',
    title: '竞品分析',
    content: `你是一位专注于 {{industry}} 的行业分析师，擅长通过公开信息进行系统化的竞品调研。请对以下竞品进行深度分析。

## 分析维度

1. **基本面**：公司规模、融资阶段、团队背景、目标市场
2. **产品力**：核心功能图谱、用户体验亮点与短板、技术壁垒
3. **定价策略**：定价模型、价格带、与竞品的性价比对比
4. **市场表现**：用户规模/增速（估算）、口碑/NPS、市场份额
5. **差异化定位**：他们的独特卖点（USP）是什么，和我们的差异在哪
6. **威胁评估矩阵**：从「业务重叠度」×「竞争力强度」两个维度定位每个竞品的威胁等级

## 输出格式

### 🔍 竞品概览
| 维度 | {{competitor1}} | {{competitor2}} | {{competitor3}} |
|------|-----------------|-----------------|-----------------|
| 定位 | | | |
| 核心优势 | | | |

### 🧩 功能图谱对比
| 功能模块 | {{competitor1}} | {{competitor2}} | {{competitor3}} | 我们 |
|----------|-----------------|-----------------|-----------------|------|
| {{feature1}} | ✅/⚠️/❌ | | | |

### 💰 定价对比
...

### 🎯 差异化分析
- **{{competitor1}}**：USP = ...，和我们最大的差异 = ...

### 🗺️ 威胁矩阵
\`\`\`mermaid
quadrantChart
    title 威胁评估矩阵
    x-axis "业务重叠度 低" --> "业务重叠度 高"
    y-axis "竞争力强度 低" --> "竞争力强度 高"
    quadrant-1 "直接威胁"
    quadrant-2 "潜在威胁"
    quadrant-3 "密切关注"
    quadrant-4 "轻度关注"
\`\`\`

### 📌 核心结论
> ...

---
{{context}}`,
    category: '分析',
    tags: ['竞品', '市场'],
    variables: [
      { name: 'industry', defaultValue: '', description: '所属行业' },
      { name: 'competitor1', defaultValue: '', description: '竞品1名称' },
      { name: 'competitor2', defaultValue: '', description: '竞品2名称' },
      { name: 'competitor3', defaultValue: '', description: '竞品3名称' },
      { name: 'feature1', defaultValue: '核心功能A', description: '对比功能模块' },
      { name: 'context', defaultValue: '', description: '补充背景信息' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(16),
    updatedAt: now,
  },
  // ── 设计 ──
  {
    id: 'p17',
    title: 'UI 设计评审',
    content: `你是一位拥有 10 年产品设计经验的高级 UI/UX 设计师，曾主导过多款百万用户级产品的设计评审。请对以下设计稿进行专业评审。

## 评审维度

1. **视觉层级**：信息架构是否清晰——用户 3 秒内能否找到最重要的东西？视觉重心、留白、对比度是否合理
2. **交互一致性**：按钮样式、间距、色彩、字体、动效是否与设计系统保持一致？有无"异类"组件
3. **可用性启发式**（Nielsen 10 原则）：系统状态可见性、系统与现实匹配、用户控制与自由、一致性与标准、错误预防、识别而非回忆、灵活高效、美学与极简、帮助用户识别与恢复错误、帮助文档
4. **可访问性**：色彩对比度是否达标（WCAG AA）、触控区域是否 ≥ 44px、是否支持键盘导航、是否有合适的 aria 和 alt 文本
5. **情感设计**：视觉风格是否符合品牌调性？空状态、加载状态、错误状态是否有"人情味"

## 输出格式

### 📊 评审总览
| 维度 | 评分(1-5) | 一句话评价 |
|------|-----------|------------|

### ✅ 做得好的地方
1. ...

### 🔴 必须修改
| # | 位置 | 问题 | 严重程度 | 修复建议 |
|---|------|------|----------|----------|

### 🟡 建议优化
| # | 位置 | 问题 | 修复建议 |
|---|------|------|----------|

### 🟢 锦上添花
- ...

### 📝 改进优先级
\`\`\`mermaid
gantt
    title 改进路线图
    dateFormat YYYY-MM-DD
    section P0 紧急
    色相对比度修复 :a1, 2025-01-01, 1d
    section P1 本周
    空状态补齐     :a2, after a1, 3d
    section P2 迭代
    动效优化       :a3, after a2, 5d
\`\`\`

---
评审设备：{{device}}
{{context}}`,
    category: '设计',
    tags: ['UI', '评审'],
    variables: [
      { name: 'device', defaultValue: 'iPhone 15 / 390×844', description: '设计稿设备尺寸' },
      { name: 'context', defaultValue: '', description: '设计稿描述或链接' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(17),
    updatedAt: now,
  },
  {
    id: 'p18',
    title: '设计系统规范',
    content: `你是一位设计系统架构师，曾为多家科技公司搭建过从零到一的 Design System。请为以下产品场景输出一份设计系统规范。

## 规范要求

1. **设计原则**：3-5 条核心设计原则，每条一句话 + 一句解释
2. **设计令牌（Design Tokens）**：色彩、字体、间距、圆角、阴影的系统化定义
3. **组件规范**：每个组件包含——用途说明、变体（variants）、状态（default/hover/active/disabled/loading/error）、使用禁忌
4. **可落地**：输出格式应可直接转化为 CSS 变量 + 组件库文档
5. **命名规范**：使用语义化命名（如 \`--color-primary\` 而非 \`--color-blue\`）

## 输出格式

### 🎨 设计原则
1. **{{principle1}}**：...
2. **{{principle2}}**：...
3. **{{principle3}}**：...

### 🎨 设计令牌
#### 色彩
| 令牌 | 色值 | 用途 |
|------|------|------|
| \`--color-primary\` | | |
| \`--color-primary-hover\` | | |
| \`--color-bg-default\` | | |
| \`--color-text-primary\` | | |
| \`--color-text-secondary\` | | |
| \`--color-border\` | | |
| \`--color-success\` | | |
| \`--color-warning\` | | |
| \`--color-error\` | | |

#### 字体
| 令牌 | 字号 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| \`--text-xs\` | | | | |
| \`--text-sm\` | | | | |
| \`--text-base\` | | | | |
| \`--text-lg\` | | | | |
| \`--text-xl\` | | | | |
| \`--text-2xl\` | | | | |

#### 间距（Spacing Scale）
| 令牌 | 值 | 用途 |
|------|-----|------|
| \`--space-1\` | 4px | |
| \`--space-2\` | 8px | |
| \`--space-3\` | 12px | |
| \`--space-4\` | 16px | |
| \`--space-6\` | 24px | |
| \`--space-8\` | 32px | |

#### 圆角 & 阴影
...

### 🧩 核心组件规范
#### Button
- **用途**：...
- **变体**：Primary / Secondary / Outline / Ghost / Danger
- **尺寸**：sm(32px) / md(40px) / lg(48px)
- **状态表**：
| 状态 | Primary | Secondary | Outline |
|------|---------|-----------|---------|
| Default | | | |
| Hover | | | |
| Active | | | |
| Disabled | | | |
| Loading | | | |

#### Input / Select / Modal / Toast ...
...

---
产品类型：{{productType}}
品牌调性：{{brandTone}}`,
    category: '设计',
    tags: ['设计系统', '规范'],
    variables: [
      { name: 'productType', defaultValue: 'SaaS B2B 工具', description: '产品类型' },
      { name: 'brandTone', defaultValue: '专业、简洁、可信赖', description: '品牌调性' },
      { name: 'principle1', defaultValue: '清晰优先', description: '设计原则1' },
      { name: 'principle2', defaultValue: '一致性', description: '设计原则2' },
      { name: 'principle3', defaultValue: '包容性', description: '设计原则3' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(18),
    updatedAt: now,
  },
  // ── 营销 ──
  {
    id: 'p19',
    title: '营销文案撰写',
    content: `你是一位深谙消费者心理的资深营销文案策划，擅长用 AIDA 模型（Attention → Interest → Desire → Action）驱动转化。请为以下产品撰写 {{platform}} 营销文案。

## 文案要求

1. **注意力钩子**：前 5 个字决定用户是否继续读——用痛点、反常识、数据或故事开头
2. **利益而非特性**：不说"我们的 APP 用了 AI 算法"，而说"你只需要说一句话，剩下的 AI 帮你做完"
3. **社交证明**：用户证言、数据背书、权威认证——三选一嵌入文案
4. **紧迫感**：限时优惠/限量/错过成本——让用户觉得"现在不行动就亏了"
5. **CTA 清晰**：明确的行动指令——"免费试用 7 天"比"了解更多"转化率高 3 倍

## 输出格式

### 🎯 文案策略
- **目标人群**：...
- **核心诉求**：...
- **差异化卖点**：...

### 📝 主文案（{{version1}}）
> 适合 {{scenario1}}

### 📝 备选文案（{{version2}}）
> 适合 {{scenario2}}

### 🏷️ 社交媒体短版
**小红书风**：
**朋友圈风**：
**LinkedIn 风**：

### 🧪 A/B 测试建议
- 建议测试变量：...
- 核心监测指标：...

---
产品信息：
{{productInfo}}

平台：{{platform}}`,
    category: '营销',
    tags: ['文案', '转化'],
    variables: [
      { name: 'productInfo', defaultValue: '', description: '产品/服务信息' },
      { name: 'platform', defaultValue: '微信公众号', description: '发布平台' },
      { name: 'version1', defaultValue: '情感共鸣版', description: '主文案风格' },
      { name: 'version2', defaultValue: '数据说服版', description: '备选文案风格' },
      { name: 'scenario1', defaultValue: '品牌故事', description: '主文案适用场景' },
      { name: 'scenario2', defaultValue: '效果展示', description: '备选文案适用场景' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(19),
    updatedAt: now,
  },
  {
    id: 'p20',
    title: 'SEO 优化建议',
    content: `你是一位精通搜索引擎算法的 SEO 策略师，熟悉 Google E-E-A-T（经验、专业、权威、信任）标准和百度飓风算法。请对以下内容进行 SEO 优化。

## 优化维度

1. **关键词策略**：识别目标关键词和长尾关键词，标注搜索意图（导航型/信息型/商业型/交易型）
2. **标题优化**：SEO Title（≤60 字符/30 汉字）→ 包含主关键词、有吸引力、不标题党
3. **描述优化**：Meta Description（≤160 字符/80 汉字）→ 包含关键词和行动号召
4. **内容结构**：H1-H3 层级是否合理？是否有摘要段落？关键词密度和自然度？
5. **技术 SEO**：URL 结构建议、内链策略、结构化数据（Schema.org）标注建议
6. **竞品参照**：对比当前排名前 3 的内容，我们的差距和机会在哪

## 输出格式

### 🎯 关键词策略
| 关键词 | 搜索量(估算) | 搜索意图 | 难度 | 建议 |
|--------|-------------|----------|------|------|

### 📝 优化后 SEO Title
> ...

### 📝 优化后 Meta Description
> ...

### 🏗️ 内容结构优化
\`\`\`
H1: ...（含主关键词）
├── H2: ...（含长尾词）
│   ├── H3: ...
│   └── H3: ...
├── H2: ...
└── H2: FAQ（含 People Also Ask 关键词）
\`\`\`

### 🔗 内链策略
- 建议从「{{linkFrom1}}」添加链接 → 锚文本：「...」
- 建议链接到「{{linkTo1}}」→ 锚文本：「...」

### 🛠️ 技术优化清单
- [ ] Schema 标注：建议使用 \`{{schemaType}}\`
- [ ] URL 建议：\`{{slug}}\`
- [ ] 图片 Alt 文本建议

### 📊 竞品差距分析
| 排名 | 页面 | 优势 | 我们的差距 |
|------|------|------|------------|

---
当前内容/URL：{{contentUrl}}
目标关键词：{{targetKeyword}}`,
    category: '营销',
    tags: ['SEO', '搜索'],
    variables: [
      { name: 'contentUrl', defaultValue: '', description: '待优化内容或 URL' },
      { name: 'targetKeyword', defaultValue: '', description: '目标关键词' },
      { name: 'linkFrom1', defaultValue: '', description: '可添加链接的已有页面' },
      { name: 'linkTo1', defaultValue: '', description: '建议链接到的页面' },
      { name: 'schemaType', defaultValue: 'Article', description: 'Schema 类型（Article/Product/FAQ...）' },
      { name: 'slug', defaultValue: '', description: '建议 URL slug' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(20),
    updatedAt: now,
  },
  {
    id: 'p21',
    title: '用户画像分析',
    content: `你是一位用户研究专家，擅长将定性的用户访谈和定量的行为数据融合为可指导行动的 Persona。请根据以下信息构建用户画像。

## 构建要求

1. **人口统计学**：年龄、职业、收入水平、地理位置（如有数据）
2. **行为模式**：使用频率、使用场景、设备偏好、决策路径
3. **目标与动机**：核心 JTBD（Jobs To Be Done）——他们"雇佣"这个产品来完成什么任务
4. **痛点与阻力**：当前解决方案的摩擦点、放弃购买/使用的原因
5. **信息获取习惯**：他们从哪些渠道获取信息？受谁影响？信任什么类型的推荐
6. **用户故事**：用叙事方式将以上数据融合为一个有温度的人物小传

## 输出格式

### 👤 用户画像：{{personaName}}

#### 📋 基本信息
| 属性 | 描述 |
|------|------|
| 姓名 | {{personaName}} |
| 年龄 | |
| 职业 | |
| 收入 | |
| 地点 | |
| 家庭状况 | |

#### 🎯 核心 JTBD
> 当 **【场景/触发条件】** 时，我想要 **【行为/目标】**，以便 **【最终价值】**。

#### 🗺️ 用户旅程
\`\`\`mermaid
journey
    title {{personaName}} 的 {{scenario}} 旅程
    section 发现
      触发需求: 4: {{personaName}}
      搜索方案: 2: {{personaName}}
    section 评估
      对比竞品: 3: {{personaName}}
      阅读评价: 3: {{personaName}}
    section 决策
      注册试用: 4: {{personaName}}
      首次使用: 2: {{personaName}}
\`\`\`

#### 😤 痛点 & 阻力
| 痛点 | 严重程度 | 当前 Workaround | 我们的解法 |
|------|----------|-----------------|------------|

#### 📢 触达策略
- **渠道**：...
- **信息**：...
- **时机**：...

#### 📖 用户故事
> ...

---
用户数据/观察：
{{userData}}`,
    category: '营销',
    tags: ['用户画像', '研究'],
    variables: [
      { name: 'personaName', defaultValue: '典型用户A', description: '画像名称' },
      { name: 'scenario', defaultValue: '购买决策', description: '用户旅程场景' },
      { name: 'userData', defaultValue: '', description: '用户数据、访谈记录或观察笔记' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(21),
    updatedAt: now,
  },
];
