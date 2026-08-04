# next-work-dashboard 文档中心

本目录包含产品使用、开发、架构和后续规划文档。第一次接触项目时，按自己的角色选择阅读路径。

## 用户

1. [项目介绍与部署](./project-intro-and-deploy.md)
2. [用户手册](./user-guide.md)
3. [故障排查](./troubleshooting.md)

## 插件开发者

1. [插件架构与完整开发指南](./plugin-architecture.md)
2. [安全模型](./security.md)
3. 插件文档中的“待开发功能”，用于确认当前限制

## 项目开发者

1. [贡献指南](./contributing.md)
2. [功能与原理](./function-and-principles.md)
3. [架构演进路线图](./architecture-roadmap.md)
4. [安全模型](./security.md)

## 专题文档

| 文档 | 内容 | 状态 |
|---|---|---|
| [代码编辑器需求](./code-editor-requirements.md) | 编辑器目标、接口和验收标准 | 持续更新 |
| [代码编辑器未完成功能](./code-editor-remaining-features.md) | Git、AI 编辑、终端和搜索待办 | 规划 |
| [代码编辑器 Agents Window](./code-editor-agents-window.md) | Agent 会话视图、数据模型、分阶段计划和验收标准 | 开发中 |
| [终端功能](./terminal-features.md) | 终端架构、功能和已知问题 | 持续更新 |
| [Excel 插件方案](./excel-plugin-plan.md) | Excel 插件技术选型与阶段计划 | 方案 |
| [设计规范](../design/DESIGN.md) | UI 与视觉设计规范 | 参考 |

## 根目录文档

| 文档 | 内容 |
|---|---|
| [需求文档](../REQUIREMENTS.md) | 产品需求和范围 |
| [功能检查表](../FEATURE_CHECKLIST.md) | 功能完成状态 |

## 维护约定

- 代码行为变化时，同一变更中更新对应文档。
- 已实现、部分实现、待开发必须明确区分。
- 历史方案不应继续写成当前能力；需要保留时标注“历史”。
- 命令示例默认从 `prompt-lab` 目录运行。
- 插件 API 以 `plugin-architecture.md` 和源码类型为准。
