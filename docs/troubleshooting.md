# 🔧 故障排查

> 常见问题与解决办法。遇到新问题欢迎补充。

---

## 安装与启动

### `npm install` 失败

| 现象 | 解决 |
|---|---|
| `node-gyp` 编译错误 | 安装 [windows-build-tools](https://www.npmjs.com/package/windows-build-tools) (Windows) 或 Xcode Command Line Tools (macOS) |
| `python` 未找到 | 安装 Python ≥ 3.10，或设置 `npm config set python python3` |
| 网络超时 | 切换 npm 镜像：`npm config set registry https://registry.npmmirror.com` |
| 原生依赖（node-pty / lancedb）构建失败 | 运行 `npm run prepare:native` 重建原生模块 |

### 应用无法启动

| 现象 | 解决 |
|---|---|
| 白屏 / 黑屏 | 查看开发者工具 Console（`Ctrl+Shift+I`），检查是否有 JS 错误 |
| `Error: Cannot find module` | 删除 `node_modules` + `package-lock.json` 重新 `npm install` |
| Electron 启动失败 | 确认 Node.js ≥ 18，尝试 `npx electron --version` 验证 |
| 怀疑用户插件导致启动问题 | 在 `设置 → 插件` 开启**安全模式**禁用全部用户插件 |

---

## AI 站点

### 提示词无法注入

最可能的原因：AI 网站更新了页面结构，CSS 选择器失效。

1. 打开 `设置 → AI 站点`
2. 选择对应站点，点击编辑
3. 用浏览器开发者工具检查输入框，找到新的 CSS 选择器
4. 更新 `inputSelector` 和 `submitSelector`

常用选择器参考：

| 站点 | 输入框选择器 | 提交按钮选择器 |
|---|---|---|
| DeepSeek | `#chat-input` | 发送按钮 |
| ChatGPT | `#prompt-textarea` | `[data-testid="send-button"]` |
| Kimi | `.chat-input-editor` | 发送按钮 |

### 网站显示异常

| 现象 | 解决 |
|---|---|
| 页面空白 / 加载失败 | 检查网络连接，右键标签页刷新 |
| 登录态丢失 | 确认对应站点的 Cookie 设置正确，尝试重新登录 |
| 字体/布局错乱 | 可能是 WebView 版本兼容问题，尝试更新 Electron |
| 提示"使用环境异常"类反爬提示 | 确认 `webview-preload.ts` 反指纹伪装未被新版检测（可尝试更新应用） |

---

## 提示词管理

### 搜索不到提示词

- 搜索范围：标题 + 正文 + 标签
- 确认分类/标签筛选未意外限制范围
- 清除筛选器：点击分类/标签列表的"全部"

### 变量填充后注入失败

- 确认变量名在提示词中格式为 `{{变量名}}`
- 检查变量默认值是否正确
- 如果变量数 > 5，确认 VariableFillDialog 正确显示

---

## 插件

### 用户插件被禁用

插件连续 **3 次运行错误**会被熔断禁用：

1. 打开 `插件管理`
2. 找到被禁用的插件，点击"日志"查看错误详情
3. 修复脚本后重新启用

### 插件导入失败

| 错误 | 原因 |
|---|---|
| `格式无效` | `format` 必须为 `nwd-v1` |
| `runtime 不支持` | 旧版 Kernel 插件已移除，仅支持 `sandbox` |
| `文件过大` | `.nwd` 不得超过 2 MB |
| `权限不在集合内` | manifest 中声明了未知权限 |

---

## 数据与存储

### 数据丢失怎么恢复

- 应用数据库：`<userData>/next-work-dashboard.db`（Windows 下 `%APPDATA%\next-work-dashboard\next-work-dashboard.db`）
- 对话历史 / 记忆：`<documents>/next-work-dashboard/` 目录
- Token：`<userData>/.auth-tokens.enc`（safeStorage 加密，无需手动备份）
- 定期使用 `设置 → 数据管理 → 导出` 备份

### 应用卡顿 / 内存高

| 原因 | 解决 |
|---|---|
| 打开过多 WebView 标签 | 关闭不用的标签页 |
| 大量对话历史 | 清理旧对话或导出后删除 |
| 知识库索引过大 | `设置 → 知识库 → 索引管理 → 清空/重建` |
| 用户插件资源泄漏 | 禁用可疑插件，查看插件日志 |

---

## 终端

### 终端无法启动

- Windows：确认 PowerShell 已安装（`pwsh --version`），终端插件默认**未启用**，需先在活动栏启用
- macOS/Linux：确认 `bash` 或 `zsh` 可用
- 尝试在应用外打开对应终端，确认系统 shell 正常工作

### 终端命令执行失败

- 检查工作目录是否正确
- 确认 `PATH` 环境变量包含所需命令
- 避免需要交互式输入的命令（如 `ssh` 密码认证）
- 通过 `设置 → 快捷键` 检查全局快捷键是否被占用

---

## 获取更多帮助

- 查看 [用户手册](./user-guide.md)
- 查看 [项目介绍](./project-intro-and-deploy.md)
- 提交 Issue 到项目仓库
