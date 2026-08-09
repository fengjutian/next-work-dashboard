---
layout: default
title: "🔒 安全模型"
---

# 🔒 安全模型

> next-work-dashboard 安全架构说明。最后更新：2026-08-08。

---

## 1. 安全层级总览

```
┌─────────────────────────────────────────────┐
│              应用边界安全                      │
│  Fuse 保护 / asar 完整性 / Cookie 加密        │
├─────────────────────────────────────────────┤
│              进程隔离安全                      │
│  contextBridge / IPC 校验 / 参数类型检查       │
├─────────────────────────────────────────────┤
│              插件沙箱安全                      │
│  iframe sandbox / CSP / 权限控制 / 熔断       │
├─────────────────────────────────────────────┤
│              数据存储安全                      │
│  safeStorage 加密 / SQLite 本地 / 无网络上传   │
└─────────────────────────────────────────────┘
```

---

## 2. 应用边界安全

`forge.config.ts` 中 `FusesPlugin` 配置（`FuseVersion.V1`）：

| 措施 | 说明 |
|---|---|
| `RunAsNode: false` | 禁止作为 Node.js 运行 |
| `EnableCookieEncryption: true` | Cookie 加密 |
| `EnableNodeOptionsEnvironmentVariable: false` | 禁止 `NODE_OPTIONS` 环境变量注入 |
| `EnableNodeCliInspectArguments: false` | 禁止 `--inspect` 等 CLI 参数 |
| `OnlyLoadAppFromAsar: true` | 仅从 asar 归档加载代码 |
| `EnableEmbeddedAsarIntegrityValidation: true` | asar 完整性校验 |

asar 仅解包原生模块 `node-pty` 与 `@lancedb`（其余保持打包加密）。

---

## 3. 进程隔离安全

### 3.1 四层隔离

```
主进程 ←→ Preload ←→ 渲染进程 ←→ WebView Preload ←→ WebView 内容
  ✅         ✅         ✅              ✅              ❌ 不受信任
```

- 渲染进程**零 Node.js 权限**：通过 `contextBridge.exposeInMainWorld` 暴露受控 API
- WebView 通过独立的 `webview-preload.ts` 注入，不共享渲染进程的 contextBridge
- 每个 WebView 使用独立 partition（`persist:site-<siteId>`），AI 站点间无法跨站访问
- 主窗口 `contextIsolation: true`、`nodeIntegration: false`、`webviewTag: true`

### 3.2 IPC 安全

- 所有 IPC handler 在主进程侧校验参数类型和范围
- 不信任渲染进程传来的任意路径（工作区路径经 `resolveWorkspacePath` 边界校验，防符号链接逃逸）
- 数据库操作通过主进程中转，渲染进程不直接写磁盘（sql.js 导出字节流后由主进程落盘）

---

## 4. 插件沙箱安全

### 4.1 Sandbox 限制

```html
<iframe sandbox="allow-scripts" />
```

未授权的能力：
- ❌ `allow-same-origin` — 无法读取宿主 Cookie/localStorage
- ❌ `allow-popups` — 无法弹窗
- ❌ `allow-top-navigation` — 无法导航宿主
- ❌ `allow-forms` — 无法提交表单

### 4.2 CSP 策略（`plugin-frame.html`）

```
default-src 'none'
script-src 'unsafe-inline'
style-src 'unsafe-inline'
img-src data: https:
font-src data:
```

- 禁止任意网络请求
- 图片仅允许 `data:` 和 `https:`

### 4.3 权限模型

| 权限 | 风险等级 | 说明 |
|---|---|---|
| `store.read` | 低 | 只读快照数据 |
| `clipboard` | 中 | 写入剪贴板 |
| `inject` | 高 | 向 AI 站点注入内容 |
| `external.open` | 中 | 打开外部链接 |
| `data` | 低 | 插件私有存储 |
| `preview` | 低 | 内容预览 |
| `file.read` | 中 | 读取用户选择的文件 |
| `file.write` | 高 | 写入用户选择的位置 |

每次 Bridge 调用同时检查声明权限和当前授权状态。

### 4.4 熔断与安全模式

- 插件连续 **3 次运行错误** → 自动禁用
- **安全模式**：禁用全部用户插件，用于排查启动问题
- 导入时校验权限在已知集合内

---

## 5. 数据存储安全

### 5.1 Token 保护

```
用户输入 API Key
  → safeStorage.encryptString()
  → 写盘到 <userData>/.auth-tokens.enc（OS 原生加密，Windows DPAPI / macOS Keychain / Linux libsecret）
  → 使用时 safeStorage.decryptString()
```

- Token 永不以明文写入磁盘
- 不在 SQLite 或 localStorage 中存储

### 5.2 本地优先

| 数据类型 | 存储位置 | 网络暴露 |
|---|---|---|
| 提示词 / 站点 / 设置 | 本地 SQLite | ❌ 无 |
| 对话历史 | 本地 Markdown | ❌ 无 |
| 插件数据 | 本地 localStorage | ❌ 无 |
| AI 对话内容 | AI 网站服务器 | ⚠️ 取决于使用的 AI 服务 |

---

## 6. 外链安全

`external.open` 权限的链接打开规则（`usePluginBridge.ts`）：

- ✅ 允许协议：`https:` / `http:` / `mailto:`
- ✅ URL 长度上限 2048 字符
- ❌ 拒绝：含用户名密码的 URL（如 `https://user:pass@host`）
- ❌ 拒绝：`file:` / `javascript:` / `data:` 等其余协议
- 所有外链通过系统默认浏览器打开（`noopener,noreferrer`），不在应用内 webview 中加载

> 该规则作用于插件 SDK 的 `openUrl` 调用。宿主自身 IPC `shell:open-external` 用于应用内部功能，不经过插件权限校验。

---

## 7. AI Agent 轻量执行隔离

AI 对话不开放任意 Shell。代码场景仅通过 `workspace_list_scripts` 查看当前工作区 `package.json` 中的脚本，并通过 `workspace_run_script` 按脚本名称执行。

代码对话第一次写文件、局部编辑或运行项目脚本时，会自动创建以对话 ID 命名的独立 Git Worktree（分支 `agent/<sessionId>`，存储于 `<userData>/agent-worktrees/`）。后续工具操作转向该 Worktree，主工作区保持不变；界面显示隔离分支，并仅允许用户手动选择合并或放弃，AI 工具没有合并权限。

首次创建 Worktree 时主工作区必须干净。若存在未提交修改，系统停止 AI 写入并要求用户先提交或存入 Git Stash，避免 Worktree 基于旧 HEAD、遗漏用户当前修改，或在合并时混淆用户改动与 AI 改动。已经存在的会话 Worktree 可以在主工作区变脏后继续恢复，但合并仍要求主工作区干净。

- 主进程再次校验脚本必须存在于当前已授权工作区的 `package.json`。
- 使用 `npm run <script>` 的结构化参数调用，不接受任意命令字符串或附加参数。
- 子进程只继承运行所需的最小环境变量，不继承 API Key、云凭据等 Secret。
- 默认超时 120 秒，最大 10 分钟；默认输出上限 2 MB。
- 工作目录固定在已授权工作区，路径访问仍由工作区边界校验保护。
- 该机制用于降低误操作范围，不等同于容器或虚拟机级安全沙箱；项目自身已有脚本仍视为受信任代码。

## 8. 安全检查清单

- [ ] 第三方依赖定期审计（`npm audit`）
- [ ] WebView 不加载不可信 URL
- [ ] 用户插件仅从可信来源安装
- [ ] 敏感权限（inject/file.write）按需授予
- [ ] 定期检查插件日志中的异常模式
