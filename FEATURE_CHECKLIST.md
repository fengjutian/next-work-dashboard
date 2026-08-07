# next-work-dashboard 功能对照表

> 生成日期：2026-08-06 | 基准文档：REQUIREMENTS.md | 代码版本：0.2.0
>
> 更新说明：
> - **S06 默认注入模式已持久化**，由 ❌ 提升为 ✅（实现于 `store/store.ts`）；
> - **设置模块从 S01-S15 旧模型扩展为实际 8 个 Tab 的新模型**（新增 AI API / 知识库 / 插件 / 数据管理 / 关于 5 个 Tab，需求扩展至 S16-S30）；
> - 新增 Word 预览（W01-W22）与 Excel 预览编辑（E01-E09）模块；
> - 扩展需求外已实现功能清单，刷新统计与待补缺口。

---

## 一、设置模块（Settings）

> 设置面板 `components/settings/SettingsSidebar.tsx` 现包含 8 个 Tab：
> **AI API / 知识库 / AI 站点 / 插件 / 外观 / 快捷键 / 数据管理 / 关于**（keep-alive 常驻，CSS 显隐）。

### Tab 1 · AI API（`components/settings/SettingsAiApi.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S16** | API Key 配置 | ✅ | `SettingsAiApi.tsx` + `auth/token-store.ts` | safeStorage 加密存储，明/暗切换 |
| **S17** | 模型选择 | ✅ | `SettingsAiApi.tsx` | deepseek-v4-flash / deepseek-v4-pro |
| **S18** | API Base URL | ✅ | `SettingsAiApi.tsx` | OpenAI 兼容 |
| **S19** | 连接测试 | ✅ | `SettingsAiApi.tsx` | GET `/models` 探测并展示状态 |

### Tab 2 · 知识库（`components/settings/SettingsMemory.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S20** | Memory Provider 选择 | ✅ | `SettingsMemory.tsx` | 本地索引 / OpenAI 兼容 Embedding |
| **S21** | Embedding 配置 | ✅ | `SettingsMemory.tsx` | Base URL / Key / 模型 + 测试连接 |
| **S22** | 本地语义 Embedding | ✅ | `SettingsMemory.tsx` + `core/memory/local-embedding.ts` | Transformers.js 本地模型，断网可用 |
| **S23** | TencentDB Agent Memory | ✅ | `SettingsMemory.tsx` + `core/tencentdb-memory-adapter.ts` | 兼容连接 + 能力探测，未配置时回退本地索引 |
| **S24** | 检索参数 | ✅ | `SettingsMemory.tsx` | 上下文预算 / 召回片段 / 相关度 / 单文件上限 |
| **S25** | 索引管理 | ✅ | `SettingsMemory.tsx` + `core/conversation-memory.ts` | 更新 / 强制重建 / 取消 / 清空 + 自动索引 |

### Tab 3 · AI 站点（`components/settings/SettingsAISites.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S01** | 预设站点列表 | ✅ | `store/types.ts` | DeepSeek / ChatGPT / Kimi / 通义千问 / 豆包 / Gemini |
| **S02** | 自定义站点 | ✅ | `store/store.ts` + `SettingsAISites.tsx` | addSite() |
| **S03** | 站点配置 (名称/URL/选择器/启用) | ✅ | `components/SiteRow.tsx` | inputSelector / submitSelector / enabled |
| **S04** | 站点排序 | ⚠️ | `store/types.ts` | sortOrder 字段存在，无拖拽 UI |

### Tab 4 · 插件（`components/settings/SettingsPlugins.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S26** | 插件设置项 | ✅ | `SettingsPlugins.tsx` + `plugins/registry.ts` | 声明式 settings 自动渲染 |
| **S27** | 插件权限管理 | ✅ | `SettingsPlugins.tsx` + `plugins/plugin-storage.ts` | 8 项权限授予/回收 |
| **S28** | 用户插件管理 | ✅ | `plugins/plugin-manager/` | 加载 / 卸载 / 导入导出 |

### Tab 5 · 外观（`components/settings/SettingsAppearance.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S11** | 主题切换 (亮/暗/系统) | ✅ | `SettingsAppearance.tsx` + `store/store.ts` | 持久化 |

### Tab 6 · 快捷键（`components/settings/SettingsShortcuts.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S08** | 全局快捷键唤出 | ✅ | `main/shortcuts.ts` | Ctrl+Shift+Space |
| **S09** | 注入快捷键 | ✅ | `SettingsShortcuts.tsx` | Ctrl+K 唤出 CommandPalette |
| **S10** | 快捷键自定义 | ⚠️ | `main/shortcuts.ts` | IPC 支持加载自定义，UI 只读 |

### Tab 7 · 数据管理（`components/settings/SettingsDataManagement.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S29** | 提示词导入/导出 | ✅ | `components/ImportExport.tsx` | JSON / Markdown，重复检测 |

### Tab 8 · 关于（`components/settings/SettingsAbout.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S30** | 版本信息 | ✅ | `SettingsAbout.tsx` | v0.2.0 |

### 工具栏 · 注入策略（非 Tab，`App.tsx`）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S05** | 注入模式 (仅填充 / 填充并发送) | ✅ | `App.tsx` + `store/store.ts` | 工具栏 toggle，持久化 |
| **S06** | 默认注入模式 | ✅ | `store/store.ts` | `dbSetSetting('injectMode')` 持久化 + 启动时 `loadFromDb()` 恢复 |
| **S07** | 追加/替换策略 | ✅ | `App.tsx` + `store/store.ts` | 工具栏 toggle，持久化 |
| **S12** | 多语言 (中/英) | ❌ | — | 当前仅中文 |
| **S13** | 窗口置顶 | ⚠️ | `preload.ts` (`toggleAlwaysOnTop`) | IPC 已实现，无 UI 入口 |
| **S14** | 开机启动 | ⚠️ | `preload.ts` (`getAutoLaunch`/`setAutoLaunch`) | IPC 已实现，无 UI 开关 |
| **S15** | 代理设置 | ❌ | `db/schema.ts` | useProxy 字段预留，无逻辑 |

---

## 二、提示词管理模块（Prompt Management）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **P01** | 创建提示词 | ✅ | `PromptSidebar.tsx` | 标题/正文/分类/标签/变量 |
| **P02** | 编辑提示词 | ✅ | `store/store.ts` | updatePrompt() patch |
| **P03** | 删除提示词 | ✅ | `store/store.ts` | 单个 + 批量删除 |
| **P04** | 查看提示词 | ✅ | `PromptSidebar.tsx` | 列表 + 详情预览 |
| **P05** | 复制提示词 | ✅ | `PromptSidebar.tsx` | electronAPI.copyText |
| **P06** | 分类管理 | ✅ | `store/types.ts` + `store/store.ts` | 7 预设 + 自定义 |
| **P07** | 标签系统 | ✅ | `store/store.ts` | useAllTags 聚合筛选 |
| **P08** | 搜索过滤 | ✅ | `store/store.ts` | 标题+正文+标签模糊搜索 |
| **P09** | 变量占位符 `{{变量名}}` | ✅ | `VariableFillDialog.tsx` | 正则解析 |
| **P10** | 变量填充面板 | ✅ | `VariableFillDialog.tsx` | 注入前弹出 |
| **P11** | 变量默认值 | ✅ | `store/types.ts` | PromptVariable.defaultValue |
| **P12** | 导出 (JSON/Markdown) | ✅ | `ImportExport.tsx` | 全量/选中导出 |
| **P13** | 导入 (JSON/Markdown) | ✅ | `ImportExport.tsx` | 重复检测 |
| **P14** | 数据目录 | ⚠️ | `main/workspace-path.ts` | 固定路径，不可自定义 |
| **P15** | 收藏/置顶 | ✅ | `PromptSidebar.tsx` | 排序优先级 |
| **P16** | 最近使用 | ✅ | `store/store.ts` | useRecentPrompts(5) |
| **P17** | 使用计数 | ✅ | `store/store.ts` | incrementUsage |

---

## 三、浏览器 / 注入模块（Browser & Inject）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **B01** | 多标签 WebView | ✅ | `WebViewContainer.tsx` | tabs[] 状态管理 |
| **B02** | 标签页管理 (新建/关闭/切换) | ✅ | `WebViewContainer.tsx` | + 下拉 / X 关闭 / 点击切换 |
| **B03** | 页面导航 (前进/后退/刷新) | ✅ | `WebViewContainer.tsx` | goBack/goForward/reload |
| **B04** | 持久化 Session | ✅ | `WebViewContainer.tsx` | persist:site-{id} |
| **B05** | 注入触发 (侧边栏/右键/快捷键) | ✅ | `WebViewContainer.tsx` | 三种触发方式 |
| **B06** | DOM 选择器注入 | ✅ | `WebViewContainer.tsx` | executeJavaScript |
| **B07** | 注入状态反馈 (Toast) | ✅ | `WebViewContainer.tsx` | 成功/失败提示 |
| **B08** | 模拟 Input/Change 事件 | ✅ | `WebViewContainer.tsx` | dispatchEvent |
| **B09** | 自动发送 | ✅ | `WebViewContainer.tsx` | 200ms 延迟点击 |
| **B10** | 侧边栏 (提示词列表) | ✅ | `App.tsx` | 左侧固定 |
| **B11** | 侧边栏折叠 | ✅ | `App.tsx` | ActivityBar + PromptDrawer |
| **B12** | 浮动快捷面板 (Spotlight) | ✅ | `CommandPalette.tsx` | Ctrl+K 唤出 |

---

## 四、Word 预览/编辑模块（word-preview）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **W01** | 文件打开 (.docx) | ✅ | `plugins/word-preview/WordPreviewPanel.tsx` | 文件选择器 |
| **W02** | 拖拽打开 | ✅ | `WordPreviewPanel.tsx` | 拖拽到预览区 |
| **W03** | HTML 预览 | ✅ | `WordPreviewPanel.tsx` + `convert.ts` | mammoth.js docx→HTML |
| **W04** | 图片渲染 | ✅ | `convert.ts` | 内嵌图片正确显示 |
| **W05** | 表格渲染 | ✅ | `convert.ts` | 表格转 HTML 表格 |
| **W06** | 基础样式 | ✅ | `convert.ts` | 粗体/斜体/下划线/删除线/上下标/链接 |
| **W07** | 标题层级 | ✅ | `convert.ts` | Heading 1-6 映射 |
| **W08** | 列表支持 | ✅ | `convert.ts` | 有序/无序/嵌套列表 |
| **W09** | 只读预览模式 | ✅ | `WordPreviewPanel.tsx` | 默认只读，保护原文件 |
| **W10** | 页面样式 | ✅ | `WordPreviewPanel.tsx` | 白色纸张效果 + 适当宽度 |
| **W11-W16** | 编辑/导出 (V2) | ❌ | — | 依赖 Tiptap、docx 库未引入 |
| **W17-W22** | 高级功能 (V3) | ❌ | — | 修订追踪/批注/页眉页脚/分页/格式刷/查找替换 |

---

## 五、Excel 预览编辑模块（excel-preview）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **E01** | 打开 Excel 文件 | ✅ | `plugins/excel-preview/ExcelPreviewPanel.tsx` | .xlsx/.xls/.xlsm/.xlsb/.csv |
| **E02** | 多 Sheet 切换 | ✅ | `ExcelPreviewPanel.tsx` + `Toolbar.tsx` | 标签栏切换 |
| **E03** | 表格预览 | ✅ | `ExcelGrid.tsx` | 虚拟滚动，A/B/C 列标 + 行号 |
| **E04** | 单元格编辑 | ✅ | `ExcelGrid.tsx` + `useExcelStore.ts` | 双击/Enter 进入编辑，Tab/方向键导航 |
| **E05** | 保存 | ✅ | `ExcelPreviewPanel.tsx` | Ctrl+S 写回原文件 |
| **E06** | 另存为 | ✅ | `ExcelPreviewPanel.tsx` | 导出 .xlsx |
| **E07** | 撤销/重做 | ✅ | `useExcelStore.ts` | Ctrl+Z / Ctrl+Y，200 步操作栈 |
| **E08** | 添加/删除行列 | ✅ | `ExcelPreviewPanel.tsx` + `Toolbar.tsx` | 工具栏操作 |
| **E09** | 键盘导航 | ✅ | `ExcelGrid.tsx` | 方向键移动、Delete 清空、F2 编辑 |

---

## 六、需求外已实现功能

| 功能 | 实现位置 | 说明 |
|------|----------|------|
| Token 安全存储 | `auth/token-store.ts` + 6 个 IPC | safeStorage + OS 原生加密 |
| 对话历史保存 | `SaveConversationPanel` + `ConversationHistory` | DOM 提取 → Markdown → 管理 |
| 站点 Favicon 获取 | `main/favicon.ts` | 主进程 HTTP → base64 缓存 |
| 系统托盘 | `main/tray.ts` | 关闭最小化，双击恢复 |
| VSCode 风格 ActivityBar | `ActivityBar.tsx` | 多面板切换 |
| 对话标注保存 | `SaveConversationPanel.tsx` | 标题+备注独立文件 |
| 代码编辑器 + AI Agents | `plugins/code-editor/` | worktree 隔离、Diff 审阅、验证流水线、Token 预算 |
| MCP 管理 | `main/mcp/` + `core/tools/mcp-tools.ts` | 服务配置、工具注入、审批流 |
| Agent 任务服务 | `main/agent-task-service.ts` + `main/task-runner.ts` | 任务队列、取消/重试、执行指标 |
| 语义搜索 | `main/semantic-search.ts` + `core/knowledge/` | LanceDB 向量检索 |
| 知识图谱 | `plugins/knowledge-graph/` | 图谱抽取、图谱/桑基图视图 |
| 代码工作区 | `plugins/code-editor/` + `core/tools/code-workspace-tools.ts` | 工作区搜索、事务、PR 交付 |
| Git 服务 | `main/git-*.ts` | 历史、诊断、冲突解决、重命名冲突 |
| 终端 | `plugins/terminal/` | node-pty 终端 |
| PDF / PPT 预览 | `plugins/pdf-preview/`、`plugins/ppt-preview/` | 纯前端转换预览 |
| 数据库浏览器 | `plugins/database/DatabaseBrowser.tsx` | sql.js 数据浏览 |
| Excalidraw 白板 | `plugins/excalidraw/` | 画布编辑 |
| 微信读书 | `plugins/weread/` | 阅读数据统计与洞察 |
| 翻译插件 | `plugins/translation/` | 翻译面板 |
| 天气插件 | `plugins/windy/` | Windy 地图面板 |
| 插件沙箱 | `plugins/sandbox/` + `plugins/dynamic/` | iframe 隔离、CSP 严格限制、7 通道 8 权限 |

---

## 七、总览统计

| 模块 | 需求项 | ✅ 完成 | ⚠️ 半完成 | ❌ 未实现 | 完成率 |
|------|:--:|:--:|:--:|:--:|:--:|
| 设置 (S01-S30) | 30 | 24 | 4 | 2 | 80% |
| 提示词管理 (P01-P17) | 17 | 16 | 1 | 0 | 94% |
| 浏览器/注入 (B01-B12) | 12 | 12 | 0 | 0 | 100% |
| Word (W01-W22) | 22 | 10 | 0 | 12 | 45% |
| Excel (E01-E09) | 9 | 9 | 0 | 0 | 100% |
| **合计** | **90** | **71** | **5** | **14** | **79%** |

## 八、待补缺口（按优先级）

| 优先级 | 编号 | 问题 | 说明 |
|:--:|------|------|------|
| **高** | S13 | 窗口置顶无 UI 入口 | `preload.ts` 已暴露 `toggleAlwaysOnTop`，但用户无法触发 |
| **高** | S14 | 开机启动无 UI 开关 | `preload.ts` 已暴露 `getAutoLaunch`/`setAutoLaunch`，但无开关 |
| **中** | S10 | 快捷键自定义 UI 只读 | 无法在界面修改快捷键 |
| **中** | S04 | 站点拖拽排序缺失 | sortOrder 存在但无法交互 |
| **中** | P14 | 数据目录不可自定义 | 数据路径固定 |
| **低** | S12 | 多语言 | 当前仅中文 |
| **低** | S15 | 代理设置 | DB 预留字段无逻辑 |
| **规划** | W11-W16 | Word 编辑/导出 | V2 阶段，依赖 Tiptap、docx 库未引入 |
| **规划** | W17-W22 | Word 高级功能 | V3 阶段（修订追踪/批注/页眉页脚等） |
