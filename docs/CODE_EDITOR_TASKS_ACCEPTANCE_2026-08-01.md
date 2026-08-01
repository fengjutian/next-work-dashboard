# Tasks / Problem Matcher 增量验收（2026-08-01）

| 功能 | 状态 | 证据与限制 |
|---|---|---|
| tasks.json 结构化读取 | 通过 | 解析 label、command、args、dependsOn、dependsOrder、isBackground、problemMatcher、options.env 和 presentation。 |
| dependsOn | 部分通过 | 运行前执行依赖拓扑排序、去重，并检测缺失依赖和循环；当前依赖命令按顺序写入同一终端，parallel 尚未由独立进程并行调度。 |
| Problem Matcher | 部分通过 | 支持 `$tsc`、`$eslint-stylish`、`$gcc` 和通用路径/行列格式，并写入 Problems；多行/自定义 regexp、background begins/endsPattern 尚未完成。 |
| 生命周期状态 | 部分通过 | UI 展示 running/background，运行时清理上次 Problems；完成、失败、取消仍需独立 Task Runner 根据退出码驱动。 |
| 环境与 presentation | 部分通过 | 配置数据已完整传输；任务专属环境注入和 reveal/panel/focus 行为尚未全部执行。 |

自动化结果：TypeScript 通过；21 个测试文件、133 项测试全部通过。
