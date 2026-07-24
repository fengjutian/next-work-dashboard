# next-work-dashboard 功能对照表

> 生成日期：2026-07-24 | 基准文档：REQUIREMENTS.md | 代码版本：0.1.0

---

## 一、设置模块（Settings）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **S01** | 预设站点列表 | ✅ | `store/types.ts:47-102` | DeepSeek / ChatGPT / Kimi / 通义千问 / 豆包 / Gemini |
| **S02** | 自定义站点 | ✅ | `store/index.ts:141` | addSite() + SettingsAISites 面板 |
| **S03** | 站点配置 (名称/URL/选择器/启用) | ✅ | `components/SiteRow.tsx` | inputSelector / submitSelector / enabled |
| **S04** | 站点排序 | ⚠️ | `store/types.ts:30` | sortOrder 字段存在，无拖拽 UI |
| **S05** | 注入模式 (仅填充 / 填充并发送) | ✅ | `App.tsx:102-125` | 工具栏 toggle |
| **S06** | 默认注入模式 | ❌ | `store/index.ts:175` | 硬编码 'fill-only'，未持久化 |
| **S07** | 追加/替换策略 | ✅ | `App.tsx:127-148` | 工具栏 toggle |
| **S08** | 全局快捷键唤出 | ✅ | `main.ts:559-595` | Ctrl+Shift+Space |
| **S09** | 注入快捷键 | ✅ | `SettingsShortcuts.tsx` | Ctrl+K 唤出 CommandPalette |
| **S10** | 快捷键自定义 | ⚠️ | `main.ts:573-594` | IPC 支持加载自定义，UI 只读 |
| **S11** | 主题切换 (亮/暗/系统) | ✅ | `App.tsx:76-83` | SettingsAppearance 面板 |
| **S12** | 多语言 (中/英) | ❌ | — | V1 仅中文 |
| **S13** | 窗口置顶 | ⚠️ | `main.ts:301-305`, `preload.ts:32` | IPC 已实现，无 UI 入口 |
| **S14** | 开机启动 | ⚠️ | `main.ts:308-319` | IPC 已实现，无 UI 开关 |
| **S15** | 代理设置 | ❌ | `db/schema.ts:26` | useProxy 字段预留，无逻辑 |

---

## 二、提示词管理模块（Prompt Management）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **P01** | 创建提示词 | ✅ | `PromptSidebar.tsx` | 标题/正文/分类/标签/变量 |
| **P02** | 编辑提示词 | ✅ | `store/index.ts:91-96` | updatePrompt() patch |
| **P03** | 删除提示词 | ✅ | `store/index.ts:98-108` | 单个 + 批量删除 |
| **P04** | 查看提示词 | ✅ | `PromptSidebar.tsx` | 列表 + 详情预览 |
| **P05** | 复制提示词 | ✅ | `PromptSidebar.tsx:39-47` | electronAPI.copyText |
| **P06** | 分类管理 | ✅ | `store/types.ts:104`, `store/index.ts:189-193` | 7 预设 + 自定义 |
| **P07** | 标签系统 | ✅ | `store/index.ts:239-244` | useAllTags 聚合筛选 |
| **P08** | 搜索过滤 | ✅ | `store/index.ts:208-236` | 标题+正文+标签模糊搜索 |
| **P09** | 变量占位符 `{{变量名}}` | ✅ | `VariableFillDialog.tsx:7-15` | 正则解析 |
| **P10** | 变量填充面板 | ✅ | `VariableFillDialog.tsx` | 注入前弹出 |
| **P11** | 变量默认值 | ✅ | `store/types.ts:5` | PromptVariable.defaultValue |
| **P12** | 导出 (JSON/Markdown) | ✅ | `ImportExport.tsx:9-55` | 全量/选中导出 |
| **P13** | 导入 (JSON/Markdown) | ✅ | `ImportExport.tsx:56-100` | 重复检测 |
| **P14** | 数据目录 | ⚠️ | `main.ts:322` | 固定路径，不可自定义 |
| **P15** | 收藏/置顶 | ✅ | `PromptSidebar.tsx:49-57` | 排序优先级 |
| **P16** | 最近使用 | ✅ | `store/index.ts:247-259` | useRecentPrompts(5) |
| **P17** | 使用计数 | ✅ | `store/index.ts:116-121` | incrementUsage |

---

## 三、浏览器 / 注入模块（Browser & Inject）

| 编号 | 需求 | 状态 | 实现位置 | 备注 |
|------|------|:--:|----------|------|
| **B01** | 多标签 WebView | ✅ | `WebViewContainer.tsx:577` | tabs[] 状态管理 |
| **B02** | 标签页管理 (新建/关闭/切换) | ✅ | `WebViewContainer.tsx:13-80` | + 下拉 / X 关闭 / 点击切换 |
| **B03** | 页面导航 (前进/后退/刷新) | ✅ | `WebViewContainer.tsx:468-492` | goBack/goForward/reload |
| **B04** | 持久化 Session | ✅ | `WebViewContainer.tsx:538` | persist:site-{id} |
| **B05** | 注入触发 (侧边栏/右键/快捷键) | ✅ | `WebViewContainer.tsx:435-461` | 三种触发方式 |
| **B06** | DOM 选择器注入 | ✅ | `WebViewContainer.tsx:380-413` | executeJavaScript |
| **B07** | 注入状态反馈 (Toast) | ✅ | `WebViewContainer.tsx:416-432` | 成功/失败提示 |
| **B08** | 模拟 Input/Change 事件 | ✅ | `WebViewContainer.tsx:400-401` | dispatchEvent |
| **B09** | 自动发送 | ✅ | `WebViewContainer.tsx:403-409` | 200ms 延迟点击 |
| **B10** | 侧边栏 (提示词列表) | ✅ | `App.tsx:171-173` | 左侧固定 |
| **B11** | 侧边栏折叠 | ✅ | `App.tsx` | ActivityBar + PromptDrawer |
| **B12** | 浮动快捷面板 (Spotlight) | ✅ | `CommandPalette.tsx` | Ctrl+K 唤出 |

---

## 四、需求外已实现功能

| 功能 | 实现位置 | 说明 |
|------|----------|------|
| Token 安全存储 | `auth/token-store.ts` + 6 个 IPC | safeStorage + OS 原生加密 |
| 对话历史保存 | `SaveConversationPanel` + `ConversationHistory` | DOM 提取 → Markdown → 管理 |
| 站点 Favicon 获取 | `main.ts:114-213` | 主进程 HTTP → base64 缓存 |
| 系统托盘 | `main.ts:65-101` | 关闭最小化，双击恢复 |
| VSCode 风格 ActivityBar | `ActivityBar.tsx` | 4 面板切换 |
| 对话标注保存 | `SaveConversationPanel.tsx` | 标题+备注独立文件 |

---

## 五、总览统计

| 模块 | 需求项 | ✅ 完成 | ⚠️ 半完成 | ❌ 未实现 | 完成率 |
|------|:--:|:--:|:--:|:--:|:--:|
| 设置 (S01-S15) | 15 | 6 | 4 | 3 | 40% |
| 提示词管理 (P01-P17) | 17 | 15 | 1 | 0 | 88% |
| 浏览器/注入 (B01-B12) | 12 | 12 | 0 | 0 | 100% |
| **合计** | **44** | **33** | **5** | **3** | **75%** |

## 六、待补缺口（按优先级）

| 优先级 | 编号 | 问题 | 说明 |
|:--:|------|------|------|
| **高** | S06 | 默认注入模式未持久化 | 用户每次启动需重新设置 |
| **高** | S13 | 窗口置顶无 UI 入口 | IPC 已实现但用户无法触发 |
| **高** | S14 | 开机启动无 UI 开关 | IPC 已实现但无处设置 |
| **中** | S10 | 快捷键自定义 UI 只读 | 无法在界面修改快捷键 |
| **中** | S04 | 站点拖拽排序缺失 | sortOrder 存在但无法交互 |
| **中** | P14 | 数据目录不可自定义 | 数据路径固定 |
| **低** | S12 | 多语言 | V1 计划仅中文 |
| **低** | S15 | 代理设置 | DB 预留字段无逻辑 |
