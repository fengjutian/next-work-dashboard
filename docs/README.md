# 📚 next-work-dashboard 文档中心

> 按角色选择阅读路径，5 分钟了解全貌，30 分钟深入核心。

---

## 🧭 快速导航

| 我想… | 看这个 |
|---|---|
| 了解这个项目是什么 | → [项目介绍与部署](./project-intro-and-deploy.md) |
| 安装并使用应用 | → [用户手册](./user-guide.md) |
| 开发一个插件 | → [插件架构指南](./plugin-architecture.md) |
| 参与项目开发 | → [贡献指南](./contributing.md) → [功能与原理](./function-and-principles.md) |
| 排查运行问题 | → [故障排查](./troubleshooting.md) |
| 了解功能完成度 | → [功能检查表](../FEATURE_CHECKLIST.md) |

---

## 👤 用户

1. **[项目介绍与部署](./project-intro-and-deploy.md)** — 项目定位、技术架构、安装与构建
2. **[用户手册](./user-guide.md)** — 界面结构、AI 站点配置、提示词使用、插件管理
3. **[故障排查](./troubleshooting.md)** — 常见问题与解决办法

---

## 🔌 插件开发者

1. **[插件架构指南](./plugin-architecture.md)** — 内置插件 vs Sandbox 插件、API 接口、开发流程
2. **[安全模型](./security.md)** — 沙箱限制、权限模型、CSP 策略
3. 插件文档中标注了当前限制和待开发功能

---

## 🛠️ 项目开发者

| 文档 | 内容 |
|---|---|
| **[贡献指南](./contributing.md)** | 代码规范、PR 流程、提交约定 |
| **[功能与原理](./function-and-principles.md)** | 架构原理、注入引擎、Agent 系统、数据层 |
| **[架构演进路线图](./architecture-roadmap.md)** | Core/UI 分离、Protocol 驱动、Context Provider 等 |
| **[安全模型](./security.md)** | 进程隔离、权限控制、加密存储 |

---

## 📋 专题文档

| 文档 | 内容 | 状态 |
|---|---|---|
| [代码编辑器需求](./code-editor-requirements.md) | 编辑器目标、接口和验收标准 | 🔄 持续更新 |
| [代码编辑器未完成功能](./code-editor-remaining-features.md) | Git、AI 编辑、终端和搜索待办 | 📋 规划中 |
| [代码编辑器 Agents Window](./code-editor-agents-window.md) | Agent 会话视图、数据模型、分阶段计划 | ✅ 阶段 A 已实现 |
| [代码编辑器 Agents Window 剩余工作](./code-editor-agents-window-remaining-work.md) | 阶段 B/C 待实现项 | 📋 规划中 |
| [终端功能](./terminal-features.md) | 终端架构、功能和已知问题 | 🔄 持续更新 |
| [Excel 插件方案](./excel-plugin-plan.md) | 技术选型与阶段计划 | 📋 方案 |
| [知识工作区需求](./knowledge-workspace-requirements.md) | 知识库工作区功能规划 | 📋 规划中 |
| [MCP 未完成功能](./mcp-remaining-features.md) | MCP 协议待实现项 | 📋 规划中 |

---

## 📄 根目录文档

| 文档 | 内容 |
|---|---|
| [需求文档](../REQUIREMENTS.md) | 完整产品需求与范围定义 |
| [功能检查表](../FEATURE_CHECKLIST.md) | 90 项功能的实时完成状态 |

---

## 🔧 维护约定

- 代码行为变化时，**同一变更中更新对应文档**
- 已实现 / 部分实现 / 待开发 **必须明确区分**，使用 ✅ ⚠️ ❌ 标记
- 历史方案不应继续写成当前能力；需要保留时标注 **"历史"**
- 命令示例默认从 `prompt-lab` 目录运行
- 插件 API 以 `plugin-architecture.md` 和源码类型为准
