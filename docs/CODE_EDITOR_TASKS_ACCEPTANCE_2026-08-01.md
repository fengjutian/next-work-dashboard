# Tasks / Problem Matcher 增量验收（2026-08-01）

| 功能 | 状态 | 证据与限制 |
|---|---|---|
| tasks.json 结构化读取 | 通过 | 解析 label、command、args、dependsOn、dependsOrder、isBackground、problemMatcher、options.env 和 presentation。 |
| dependsOn | 通过 | 独立 Task Runner 递归调度依赖，支持 sequence 和 parallel，并检测缺失依赖和循环。 |
| Problem Matcher | 部分通过 | 支持 `$tsc`、`$eslint-stylish`、`$gcc` 和通用路径/行列格式，并写入 Problems；多行/自定义 regexp、background begins/endsPattern 尚未完成。 |
| 生命周期状态 | 通过 | 主进程独立进程执行；输出事件流、真实退出码、completed/failed/cancelled 状态、取消入口和最近 50 次持久化历史已接入。 |
| 环境与 presentation | 部分通过 | 用户环境和任务 options.env 分层注入；Secret 在主进程从 safeStorage 解密。presentation 的 reveal/panel/focus 尚未全部执行。 |

自动化结果：TypeScript 通过；完整套件最近结果为 21 个测试文件、133 项通过；Task Runner 新增 2 项真实子进程专项测试通过。
