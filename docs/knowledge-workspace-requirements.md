# 知识工作区需求与实现方案

## 1. 背景与目标

next-work-dashboard 已具备 Markdown 对话保存、混合检索、知识图谱、工作区编辑、AI Diff 审查和文件事务能力。本阶段不建设另一套笔记应用，而是把这些能力统一为一个本地优先的知识工作区。

设计参考 OpenKnowledge 的三层思想：面向人的编辑体验、面向 Agent 的工具接口、以 Markdown/MDX 为事实源。仅参考公开架构与交互思想，代码保持独立实现，避免将 GPL-3.0 代码复制到本 MIT 项目。

## 2. 产品原则

1. **文件是真相源**：Markdown/MDX 正文由用户直接拥有；数据库只保存设置、缓存和派生索引。
2. **显式关系优先**：`[[Wiki Link]]`、frontmatter 和目录结构是可验证关系；LLM 抽取是补充关系。
3. **Agent 默认提议，不直接写入**：所有 Agent 修改先形成候选，经过 Diff 审查后再由事务层写入。
4. **本地优先与可恢复**：离线可用、写入前检查外部修改，多文件操作失败时回滚。
5. **渐进增强**：保持当前 Electron 单包工程，先形成模块边界；出现独立 CLI/MCP 进程后再拆包。

## 3. 范围

### 3.1 统一知识源

知识工作区可扫描 `.md`、`.mdx` 文件，并统一描述为 `KnowledgeDocument`：

- 稳定 URI 与工作区相对路径
- 标题、类型、标签、别名和更新时间
- frontmatter 元数据
- 正向 Wiki Links、反向链接和未解析链接
- 内容摘要及正文 hash
- 来源：普通文档、对话、提示词、规格、代码说明或导入内容

验收标准：

- 扫描不会读取工作区以外的路径。
- 支持 `[[目标]]`、`[[目标|显示文字]]` 和 `![[嵌入目标]]`。
- 链接可按文件名、无扩展相对路径、标题和 aliases 解析。
- 同名目标不猜测，记录为 ambiguous；缺失目标记录为 unresolved。
- 索引结果包含 backlinks，可直接转换为图数据。

### 3.2 Wiki Link 知识图谱

知识图谱新增“Wiki 链接”数据源，与现有关键词共现和 AI 抽取并存。显式链接边必须标记 `kind=wiki-link`，并保留来源路径，便于用户验证和跳转。

图谱提供：文档节点、链接边、反向链接计数、孤立文档、未解析链接。后续可增加局部图和路径过滤。

### 3.3 文件夹模板与内容规则

工作区通过 `.knowledge/templates/*.json` 声明模板，通过 `.knowledge/rules.json` 声明目录规则。模板负责目标目录、文件名和初始正文；规则负责必需 frontmatter、必需章节和允许的文档类型。

模板实例化必须：

- 校验模板 ID、目标路径和变量名。
- 对文件名变量进行安全 slug 化，禁止路径穿越。
- 不覆盖已有文件。
- 返回规则诊断；错误级诊断阻止写入，警告可继续。

### 3.4 可审查的 Agent 变更

统一知识变更协议包含 create/write/delete/rename 四类操作，以及 `expectedModifiedAt` 乐观锁。状态流转：

`draft -> ready-for-review -> partially-accepted|accepted|rejected|conflicted`

每个候选必须展示 before/after，支持逐块或整文件接受。多文件全部接受复用现有 `workspace:mutateFiles` 原子事务；文件在生成候选后被外部修改时进入 conflicted，不允许静默覆盖。

### 3.5 架构边界与质量门禁

在不迁移 monorepo 的前提下采用以下依赖方向：

```text
src/core/knowledge       纯解析、索引、模板、规则、提议模型
src/main                 文件系统扫描、安全路径、IPC、事务
src/plugins              React 交互与可视化
src/core/tools           Agent 工具适配
```

`core/knowledge` 不得依赖 React、Electron、Node 文件系统或 Zustand。主进程不得依赖 React。插件通过类型化 preload API 访问文件能力。

质量门禁：

- 知识核心单元测试覆盖链接解析、消歧、反链、模板安全和规则诊断。
- 工作区事务测试覆盖冲突检测和失败回滚。
- IPC 与 `ElectronAPI` 类型同步。
- lint、typecheck/构建和 Vitest 作为合并前检查。
- 文档链接、UTF-8 编码和生成文件漂移进入后续 CI。

## 4. 非目标

- 本阶段不实现完整 Notion 式 WYSIWYG。
- 不实现云端协作、GitHub 自动同步和多人冲突合并。
- 不把知识正文迁入 SQLite。
- 不开放未经审查的 Agent 任意文件写入。
- 不在本阶段拆分 pnpm/Turbo monorepo。

## 5. 迭代计划

### M1：知识核心与可验证关系

- `KnowledgeDocument`、frontmatter 和 Wiki Link 解析
- 文档索引、反向链接、歧义与缺失诊断
- 模板/规则加载、验证和实例化
- 单元测试

### M2：应用集成

- 主进程安全扫描与类型化 IPC
- 图谱切换为知识工作区数据源
- 未解析链接与孤立文档面板
- 模板创建入口

### M3：Agent 安全写入

- 通用 `KnowledgeChangeProposal`
- 接入现有 Monaco Diff、分块接受和原子事务
- 引用过期与外部修改冲突提示

### M4：生态接口

- 只读 CLI/MCP：search/read/backlinks/list templates
- 经用户确认的 propose/apply 工具
- 项目级 Agent Skill

## 6. 成功指标

- 用户可在一个工作区索引全部 Markdown/MDX，而非仅索引对话目录。
- 任何图谱边均能追溯到显式链接或明确标注的推断来源。
- 通过模板创建的文档 100% 经过路径安全与内容规则校验。
- Agent 修改不会绕过审查流程；并发修改不会被静默覆盖。
- 知识核心无需 Electron 环境即可运行全部测试。

## 7. 当前实现状态

截至首轮开发：

- [x] `KnowledgeDocument`、frontmatter、Wiki Link、aliases 与内容 hash
- [x] 链接解析、backlinks、孤立/缺失/歧义诊断
- [x] 受控工作区 Markdown/MDX 扫描与类型化 IPC
- [x] `.knowledge/templates/*.json` 和 `.knowledge/rules.json`
- [x] 内置笔记模板、安全实例化、规则校验和覆盖保护
- [x] 知识图谱工作区入口、显式链接图和诊断统计
- [x] 通用 `KnowledgeChangeProposal` 领域模型
- [x] 复用现有 AI Diff、分块接受、外部修改检测与原子回滚能力
- [x] 图节点选择、正文预览、正向链接和反向链接侧栏
- [x] 工作区标题/路径/标签/正文搜索与文档定位
- [x] Markdown 分块、BM25 + 稀疏相似度混合排序
- [x] 基于内容 hash 的工作区索引缓存与修改/删除失效
- [x] 文档类型、标签和路径前缀过滤
- [x] 缺失/歧义链接与内容规则诊断详情列表
- [ ] 编辑器行号跳转
- [x] 模板变量动态表单、必填校验与目标路径预览
- [ ] 将对话、提示词迁移到统一 `KnowledgeDocument` Provider（Markdown 工作区已接入）
- [ ] 接入本地稠密向量并持久化知识索引
- [x] 应用内 Agent：`search_knowledge`、`read_knowledge_document`、`get_knowledge_backlinks`
- [x] `propose_knowledge_change` 只生成候选，不直接写入
- [x] before/after 审查、接受/拒绝、原子应用与外部修改冲突状态
- [x] 图谱切换代码编辑器并定位 Wiki Link 行号
- [x] 编辑器 Markdown backlinks 导航条
- [x] Monaco 输入 `[[` 时按标题/路径补全文档
- [x] Markdown 重命名时原子更新所有已解析 Wiki Link 引用
- [x] 活动知识工作区跨插件共享、持久记忆与重新授权
- [ ] 独立 CLI/MCP 与项目 Agent Skill
