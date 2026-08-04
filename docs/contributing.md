# 贡献指南

## 1. 开发环境

项目主体位于 `prompt-lab`：

```powershell
cd prompt-lab
npm install
npm start
```

主要技术栈为 Electron、React、TypeScript、Vite、Zustand、Vitest 和 Tailwind CSS。

## 2. 修改原则

- 保持主进程、Preload、Renderer 和用户 Sandbox 的边界。
- Renderer 不应直接获得 Node.js 能力。
- 新 IPC 必须经过 Preload 白名单，并校验参数和路径。
- 用户插件能力必须通过 `PluginSDK` 和 Bridge 暴露。
- 不重新引入 Renderer 用户 Kernel、`eval` 或 `new Function` 执行链。
- 保留工作区中与当前任务无关的用户修改。

## 3. 目录职责

| 目录 | 职责 |
|---|---|
| `src/main/` | Electron 主进程、IPC、终端和系统能力 |
| `src/preload.ts` | 受控 Renderer API |
| `src/components/` | 公共宿主 UI |
| `src/plugins/` | 插件注册、运行时及各内置插件 |
| `src/store/` | 应用状态 |
| `src/db/` | 数据库和持久化 |
| `tests/` | Vitest 测试 |
| `docs/` | 架构、用户和开发文档 |

插件相关代码应放在 `src/plugins/`。只被单个插件使用的组件、类型和工具应放入该插件自己的目录。

## 4. 增加内置插件

1. 在 `src/plugins/<plugin-id>/` 创建组件和入口。
2. 在 `src/plugins/built-in/index.ts` 使用动态 `import()` 注册。
3. 设置稳定 ID、名称、图标、默认启用状态和顺序。
4. 按需要声明 `views`、`menus`、`settings`、`fileEditors` 和命令。
5. 只有确实需要保存界面状态时才启用 `keepAlive`。
6. 为 Registry 解析、生命周期和核心业务补测试。

## 5. 修改 PluginSDK

1. 在 `src/plugins/sandbox/plugin-sdk.ts` 修改类型和唯一运行时源码。
2. 在 `sandbox/types.ts` 更新协议、权限及数据类型。
3. 在 `usePluginBridge.ts` 实现宿主路由和参数校验。
4. 为敏感能力增加明确权限；默认拒绝。
5. 更新插件开发文档、权限矩阵和 `apiVersion` 兼容说明。
6. 补充成功、拒绝、非法参数和超时测试。

破坏兼容性的变更不能静默发布，应升级 API 版本或保留兼容路径。

## 6. 验证

提交前至少运行：

```powershell
npx tsc --noEmit
npm test
npm run lint
git diff --check
```

根据变更风险补充手动验证：

- Electron 启动和窗口行为。
- 文件选择、保存和路径边界。
- 插件导入、权限拒绝、禁用与回滚。
- 深浅主题和常见窗口尺寸。
- 原生模块和终端功能。

## 7. 文档要求

- 用户可见行为变化应更新用户手册或故障排查。
- 插件 API 变化必须更新插件架构与开发指南。
- 未完成功能应明确标记，不把计划写成现状。
- 架构决策变化应同步清理所有旧描述。

## 8. 提交检查表

- [ ] 变更范围清晰，没有混入无关格式化。
- [ ] 新增接口有类型、错误处理和边界校验。
- [ ] 新增资源在禁用或卸载时会释放。
- [ ] 测试覆盖关键成功和失败路径。
- [ ] 类型检查、测试、Lint 和差异检查通过。
- [ ] 文档与当前代码一致。
- [ ] 没有提交密钥、令牌、个人数据或生成缓存。

