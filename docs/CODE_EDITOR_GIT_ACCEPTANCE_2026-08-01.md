# Git 高级功能增量验收（2026-08-01）

本文件补充主验收报告，以本轮最新自动化结果为准。

| 功能 | 状态 | 实现与证据 |
|---|---|---|
| 提交历史分页/筛选 | 通过 | 支持消息、作者、起止日期筛选，50 条分页与继续加载；后端限制单页最大 100 条。 |
| 提交拓扑 | 部分通过 | 展示父提交关系、合并节点和 refs；目前是轻量节点视图，尚未绘制完整分叉连线。 |
| 两 Commit 比较 | 通过 | 可选择两个提交并打开 `from..to` 的 stat + patch Diff。 |
| 提交签名状态 | 通过 | 解析 `%G?` / `%GS`，展示已验证、未签名及异常状态和签名者。 |
| Credential/SSH 诊断 | 部分通过 | 新增诊断入口，报告 Git、credential.helper、Git Credential Manager、SSH Agent、提交身份和 HTTPS Proxy；网络操作错误细分为凭据、证书、代理、网络、仓库不存在、SSH Agent、权限、index.lock、safe.directory 和冲突。尚未提供图形化登录/证书安装。 |
| 复杂冲突 UI | 部分通过 | 变更列表标识 add/add、delete/modify、modify/delete、both-deleted、both-modified、unmerged，并可进入四路 Merge Result 编辑器。rename/rename 的多路径关联视图仍未完成。 |

自动化验收：TypeScript 通过；15 个测试文件、113 项测试通过（随后增加冲突分类测试后应为 16 个文件、120 项，须以最终测试输出为准）。全仓 ESLint 仍未归零；本轮定向检查中的 alias/worker resolver 错误属于现有 ESLint 配置问题。
