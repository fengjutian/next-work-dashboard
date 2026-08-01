# 终端与环境变量增量验收（2026-08-01）

| 功能 | 状态 | 证据与限制 |
|---|---|---|
| Shell 自动发现 | 通过 | 主进程按平台探测 PowerShell、PowerShell 7、cmd、Git Bash、WSL 或 Unix SHELL/zsh/bash/fish/sh，过滤不存在和重复项。 |
| 自定义 Profile | 通过 | 设置面板可添加名称、Shell 路径和启动参数，自定义项持久化并与自动发现结果合并。 |
| 环境变量分层核心 | 部分通过 | 已实现确定性的多层合并函数及删除语义；终端现有 UI 仍需拆分为用户、工作区、任务三个独立编辑层。 |
| Secret 安全存储 | 通过 | `${secret:NAME}` 仅作为引用进入 Renderer 配置，Secret 使用 Electron safeStorage/OS 加密保存，并仅在主进程创建 PTY 前解析；缺失 Secret 时拒绝启动。 |
| 任意 Pane 拖拽布局 | 未完成 | 当前仍为双 Pane 基础布局。 |
| Tasks/Problem Matcher 生命周期 | 未完成 | 下一批处理 dependsOn、后台状态、退出码和 matcher 生命周期。 |

自动化结果：TypeScript 通过；20 个测试文件、130 项测试全部通过。
