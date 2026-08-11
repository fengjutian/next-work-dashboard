---
layout: default
title: "Next Work Dashboard 文档中心"
---

# Next Work Dashboard 文档中心

这套文档覆盖产品使用、桌面端部署、插件开发、系统架构、安全边界以及专项功能设计。

可直接打开 [`index.html`](./index.html) 使用可视化文档入口。

## 推荐阅读路径

### 应用使用者

1. [用户手册](./user-guide.html)：首次设置、界面、AI 站点、提示词、编辑器与插件。
2. [故障排查](./troubleshooting.html)：安装、启动、数据、终端及插件问题。
3. [安全模型](./security.html)：本地数据、WebView、令牌和文件访问边界。

### 插件开发者

1. [插件系统可视化概览](./plugin-architecture.html)
2. [插件架构完整指南](./plugin-architecture.html)
3. [安全模型](./security.html)
4. [磁盘空间插件](./disk-space-plugin.html)或 [Office Studio](./office-studio.html)：真实插件案例。

### 项目维护者

1. [项目介绍与部署](./project-intro-and-deploy.html)
2. [功能与实现原理](./function-and-principles.html)
3. [贡献指南](./contributing.html)
4. [架构演进路线图](./architecture-roadmap.html)

## 核心文档

| 文档 | 面向对象 | 内容 |
|---|---|---|
| [项目与部署概览](./project-intro-and-deploy.html) | 所有人 | 产品定位、架构、开发与构建入口 |
| [项目介绍与部署](./project-intro-and-deploy.html) | 开发者 | 完整环境、项目结构、发布与数据说明 |
| [用户手册](./user-guide.html) | 用户 | 日常功能与快捷键 |
| [插件系统概览](./plugin-architecture.html) | 插件开发者 | Sandbox、权限和 `.nwd` 快速入门 |
| [插件架构指南](./plugin-architecture.html) | 插件开发者 | 完整接口、Manifest、SDK 示例和检查清单 |
| [功能与实现原理](./function-and-principles.html) | 维护者 | Electron、注入、状态、数据、Agent 和 IPC |
| [安全模型](./security.html) | 所有人 | 信任边界、隔离、权限与敏感数据 |
| [贡献指南](./contributing.html) | 贡献者 | 分支、代码、测试和文档规范 |

## 专项设计与计划

| 领域 | 设计文档 | 补充计划 |
|---|---|---|
| 代码编辑器 | [需求与实现](./code-editor-requirements.html) | [剩余功能](./code-editor-remaining-features.html) |
| Agents Window | [功能设计](./code-editor-agents-window.html) | [剩余工作](./code-editor-agents-window-remaining-work.html) |
| 知识工作区 | [需求与实现](./knowledge-workspace-requirements.html) | — |
| MCP | — | [后续开发计划](./mcp-remaining-features.html) |
| AI 缓存 | [缓存设计](./ai-chat-cache-design.html) | — |
| 终端 | [终端功能](./terminal-features.html) | — |
| Excel | [Excel 插件方案](./excel-plugin-plan.html) | — |
| 磁盘空间 | [Rust 插件说明](./disk-space-plugin.html) | — |
| Office | [Office Studio](./office-studio.html) | — |
| 千问 | [API 接入](./qwen-api-integration.html) | — |
| MyCast 投屏 | [MyCast 插件文档](./mycast-plugin.html) | [未完成功能交接单](./mycast-remaining-features.html) |
| 语音输入 | [Voice Input 插件](./voice-input-plugin.html) | [未完成功能交接单（W4+）](./voice-input-remaining-features.html) |

## 项目级资料

- [产品需求](../REQUIREMENTS.html)
- [功能检查表](../FEATURE_CHECKLIST.html)
- [架构路线图](./architecture-roadmap.html)

## 文档维护规则

- 功能行为变化时，在同一变更中更新对应文档。
- 明确区分已实现、部分实现和规划能力。
- 历史方案若仍需保留，必须标注日期和“历史方案”。
- npm 命令默认从 `prompt-lab` 目录执行。
- 插件接口以 `plugin-architecture.md` 和源码类型定义为准。
- HTML 页面用于浏览与快速理解，Markdown 主文档承载完整技术细节。
