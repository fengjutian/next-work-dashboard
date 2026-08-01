# Git 与 AI 高级功能增量验收（2026-08-01）

| 功能 | 状态 | 实现与证据 |
|---|---|---|
| Git 分叉拓扑图 | 通过 | 历史面板使用多车道 SVG 绘制提交节点、直线、分叉、合并和跨行曲线；未加载父提交的边延伸至分页边界。 |
| rename/rename 冲突 UI | 通过 | 联合解析 porcelain 的 `DD/AU/UA` 与 index stage 1/2/3，将旧路径、ours 新路径、theirs 新路径组合为同一冲突；Merge Editor 显示三条路径，完成时删除废弃路径并暂存结果路径。 |
| TypeScript/JavaScript Language Service | 通过 | 主进程建立项目级 TypeScript Language Service，从编辑器光标查询跨文件定义、引用和 import；其他语言保留结构化词法索引降级。 |
| 模型驱动长会话摘要 | 通过 | 会话达到 Token 预算 45% 时调用当前模型生成摘要，保留目标、决策、文件、约束和未解决项，并携带最近四条消息继续。 |
| 完整消息历史 | 通过 | 每个工作区持久化最近 100 条 user/assistant/system 消息，AI 面板展示最近消息，后续请求携带最近上下文。 |
| 中断请求恢复 | 部分通过 | 请求开始前持久化恢复点；异常退出或重启后标记 interrupted、恢复原指令并允许重新生成。尚不支持从服务端流式响应的精确字节位置续传。 |

自动化验收：TypeScript 通过；26 个测试文件、143 项测试全部通过；新增模块定向 ESLint 与 `git diff --check` 通过。
