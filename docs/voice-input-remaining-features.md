---
layout: default
title: "Voice Input：未完成功能交接单"
---

# Voice Input：未完成功能交接单

- 更新日期：2026-08-11
- 目标读者：接手 Voice Input W4+ 的开发者
- 项目目录：`prompt-lab/native/voice-engine/`（Rust sidecar）、`prompt-lab/src/plugins/voice-input/`（Electron 插件）
- 关联设计：[voice-input-plugin.md](./voice-input-plugin.md)

## 0. 状态总览

| 优先级 | 项 | 工作量 | 阻塞 / 风险 |
| --- | --- | --- | --- |
| P0 | **W4 全局热键**（任意应用内唤起录音） | 0.5-1 天 | 需选定热键 + UI 防误触 |
| P0 | **W4 文字注入**（转写完直接落到光标位置） | 1-1.5 天 | Windows SendInput vs macOS Accessibility vs Linux xdotool 分支 |
| P0 | **W4 透明悬浮窗**（录音中的浮动状态指示） | 0.5-1 天 | Electron `BrowserWindow` alwaysOnTop + 透明 + 鼠标穿透 |
| P0 | **W3 端到端验证**（用真实 API key 跑通 mic → STT → UI） | 0.5 天 | 需用户提供 OpenAI / DashScope key |
| P1 | 流式 partial transcript（边说边出字） | 1-2 天 | 需换 sherpa-onnx `OnlineRecognizer` 或 SSE/WebSocket 流式 API；需重做 Rust 侧 ASR 集成 |
| P1 | 手动停止 / 取消录音 | 0.25 天 | 需加 IPC + 按钮 + sidecar `recording.stop` |
| P1 | segment 复制按钮 | 0.1 天 | 无 |
| P1 | 麦克风设备选择 | 0.5 天 | 需 sidecar 暴露 `enumerate input devices` + UI |
| P2 | 本地 ASR 兜底（断网/失败时切 whisper.cpp） | 2-3 天 | 需解决 C++ 编译 + 下载 + 模型选型 |
| P2 | 自定义词汇表（boost "prompt-lab" 等专有名词） | 0.5-1 天 | 取决于 STT 端点是否支持 `prompt` / `hotwords` |
| P2 | 语音命令（"新行"、"句号"、"删掉" 映射到键） | 1-1.5 天 | 命令集 + 解析规则需设计 |
| P2 | 历史搜索（按时间/内容/路径查过去的转写） | 0.5-1 天 | 需把转写结果持久化到 SQLite |
| P2 | 多段合并（同思路内的短停顿合并成一段） | 0.5 天 | VAD 端 `MIN_SILENCE_MS` 调参或后处理 |
| P3 | 英文 UI i18n | 0.5 天 | 当前 UI 全中文，需引入 i18n 框架 |
| P3 | 多机同步转写历史 | 1-2 天 | 需云存储 / 端到端加密协议 |
| P3 | API 用量估算 / cost tracking | 0.25 天 | 按 segment 长度 × model 单价计 |
| P3 | 系统托盘入口 | 0.5 天 | Electron Tray API |
| P3 | Audio ducking（录音时压低其他 App 音量） | 0.5-1 天 | Windows 端 Win32 API；macOS 系统级限制 |

---

## 1. 已有能力（不要重复开发）

接手者先通读 [voice-input-plugin.md](./voice-input-plugin.md) §2 再决定改什么。下面这些是 **W1+W2+W3 已经跑通的**，重做之前先确认是不是有 race condition 而不是缺失：

- **Rust sidecar 全栈**：
  - cpal 16kHz mono 采集（自动从 48kHz 立体声降采样）
  - Silero VAD v4 切段（hysteresis + preroll 200ms + minimum speech/silence）
  - 每段写 16-bit PCM mono WAV
  - JSONL RPC（`ready`/`state`/`models`/`recording.*`/`audio.level`/`speech.*`/`error`）
  - ONNX runtime 2.0.0-rc.9 + ndarray feature 已知配对（不要换 ort 版本）
- **Main 进程服务**：
  - sidecar 生命周期 + 指数退避自动重启
  - `voice:start`/`state`/`ping`/`request-state`/`request-models`/`start-recording`/`list-recordings`/`on-event`/`transcribe` 全部 IPC
  - `voice:transcribe` 强制 HTTPS + 60s 超时
- **Renderer 面板**：
  - 三条实时条（电平 / VAD 概率 / 录音进度）
  - "VAD 就绪 / 缺失" + "STT 已配置 / 未配置" 状态徽章
  - "语音段 + 转写" 列表（最多 20 段）
  - STT 设置面板（OpenAI Whisper / 阿里云 DashScope preset + 手动输入）
  - STT 配置持久化（`dbSetSetting('voice.sttConfig', ...)`）
- **IPC 协议**：见 [voice-input-plugin.md §3](./voice-input-plugin.md#3-ipc-协议)

---

## 2. P0：W4 全局热键 + 文字注入 + 悬浮窗（最关键的一步）

### 2.1 目标

W3 跑通后用户还是得"回面板 → 点开始 → 说话 → 复制文字 → 切回目标 App → 粘贴"，这套流程对日常工作毫无用处。W4 要做到：

> 在任何 App 的文本框里按 `Ctrl+Shift+Space` → 听到"叮"一声 → 说话 → 松手 → 文字直接出现在光标位置。整个过程不离开当前 App。

### 2.2 全局热键

**功能需求**：
1. **唤起热键**（如 `Ctrl+Shift+Space`）：注册 OS 级全局热键，按下时：
   - sidecar 启动（如未启动）→ 切到录音模式
   - 透明悬浮窗出现（§2.4）
   - 麦克风开始采集
2. **松开/再次按下**：再次按热键 → 提交当前 segment → ASR → 文字注入 → 收尾
   - 第一版用"toggle"语义（按下开始，再按结束）比"按住说话"简单，避免 SendInput 在 OS 锁屏时拿不到 keyup 的边界 case
3. **可配置**：在设置里允许改热键（`globalShortcut.register` 支持）
4. **平台分支**：
   - Windows：`globalShortcut` 在 Electron 里原生 OK
   - macOS：需要 Accessibility 权限；用 `app.dock.hide()` + 隐藏 dock 图标
   - Linux：`globalShortcut` 依赖 X11/Wayland，X11 OK，Wayland 上 Electron 经常失灵

**设计草案**：
- 新建 `voice-hotkey-service.ts`（main 进程），启动时 `globalShortcut.register('CommandOrControl+Shift+Space', ...)`，回调通过 IPC 通知 renderer
- 状态机：idle → recording（按下）→ processing（松开）→ idle（注入完成）
- "processing" 期间禁用热键，避免 race

**工作量**：0.5-1 天

### 2.3 文字注入

**功能需求**：
1. **聚焦检测**：W4 唤起前记录当前 focus 的窗口/控件（用 `BrowserWindow.getFocusedWindow()` 之类，或 OS API）
2. **转写完成后注入**：
   - **方案 A（首选，跨平台）**：把文字写入剪贴板（`clipboard.writeText`），然后模拟 `Ctrl+V`
   - **方案 B（macOS）**：用 `osascript -e 'tell application "System Events" to keystroke "..."'`，需要 Accessibility 授权
   - **方案 C（Windows）**：`SendInput` 模拟 Unicode 字符，绕过剪贴板历史污染
3. **首选项**：用户选"剪贴板粘贴"或"直接打字"
4. **失败降级**：如果 OS 拒绝/没权限，至少把文字写到剪贴板 + 通知"已复制到剪贴板"

**设计草案**：
- `voice-inject-service.ts`（main 进程）暴露 `injectText(text: string, mode: 'paste' | 'type')`
- 用 `robotjs` 或 Electron `clipboard.writeText` + `webContents.sendInputEvent({type:'keyDown', keyCode:'v', modifiers:['control']})`
- macOS 需要在 `entitlements` 里加 AppleEvents 权限

**阻塞 / 风险**：
- macOS Accessibility 权限弹窗 UX（用户必须去系统设置手动开）
- Windows UIPI 提权问题（低完整性进程接收不到 SendInput）
- 一些 App（密码管理器、Electron 自己的 input）不接受模拟按键

**工作量**：1-1.5 天

### 2.4 透明悬浮窗

**功能需求**：
1. 录音时出现在屏幕底部中央 / 当前光标附近的浮窗
2. 显示：状态（"正在听..." / "转写中..." / "完成"）+ 实时电平条
3. 鼠标穿透（`setIgnoreMouseEvents(true, { forward: true })`），只让热键交互，不挡用户操作
4. 关闭时机：录音结束 + 注入完成 + 500ms 淡出

**设计草案**：
- 新建 `voice-overlay.ts`（main 进程），用 `new BrowserWindow({ frame: false, transparent: true, alwaysOnTop: true, hasShadow: false, focusable: false })`
- 加载 `voice-overlay.html`（独立 React 入口 / 或一个简单 vanilla canvas/svg）
- 通过 IPC `voice:overlay:state` 推送状态变化

**工作量**：0.5-1 天

### 2.5 验收标准

W4 完成的标志（不依赖任何 key 设置以外的额外工作）：
1. 打开任意 App（如 Chrome 地址栏 / VSCode 编辑器 / Slack 输入框）
2. 按 `Ctrl+Shift+Space` → 听到反馈 + 浮窗出现
3. 说一句中文 / 英文 → 松手
4. 2-3 秒内文字出现在焦点输入框
5. 浮窗淡出
6. 任何一步失败都给出可读的错误提示（不是 silent failure）

---

## 3. P0：W3 端到端验证

### 3.1 目标

W3 代码已 commit（`ce373dd`），但从未用真实 OpenAI / DashScope key 跑过。需要：

1. 在 dev server 启动后填 STT config
2. 触发录音 → 说话
3. 看到文字
4. 记录下任何 bug / 体验问题

### 3.2 验收清单

- [ ] 说话后 segment 卡片显示"转写中…"
- [ ] 2-3 秒内出现"transcript.final"绿底文字
- [ ] 文字内容正确（中文测试用例：报数 1-10 + 一句方言；英文测试用例：一句常见句子）
- [ ] 故意配错 key → 显示"转写失败：[401] ..."红底错误，而不是无限转圈
- [ ] STT 失败后，下一段能继续正常录音
- [ ] 配置存进 DB，重启 Electron 后还在

### 3.3 已知可能的坑

- **Aliyun DashScope `compatible-mode`** 的 `/audio/transcriptions` 端点和 OpenAI 略有差异，可能要适配 multipart 字段名（`file` vs `audio` 等）
- **跨域 / 代理**：用户如果在企业网络后面用代理 + OpenAI key，要确保 fetch 走了代理
- **大文件超时**：如果单段特别长（如 30s），multipart body 很大，可能需要 streaming 上传

---

## 4. P1：流式 partial transcript

### 4.1 目标

把"说完整段 → 出整段"改成"边说边出字"，体感延迟从"段长"降到"词级"（~200ms）。

### 4.2 设计方向

**方向 A：sherpa-onnx `OnlineRecognizer`**
- 替换现在的 `OfflineRecognizer`（sherpa-rs 那个）
- 用 `OnlineStream` 一边喂音频一边取 partial result
- 优点：本地，零延迟
- 缺点：模型切换（streaming 模型训练方式不同）；之前 sherpa-rs-sys 因为 libclang 编译不过的问题也得解决

**方向 B：OpenAI Realtime API**
- WebSocket-based streaming STT
- 优点：不用本地模型
- 缺点：要 OpenAI Realtime 权限（不是所有 key 都有）；WebSocket 集成比 HTTP 复杂

**方向 C：DashScope 实时 ASR**
- 阿里云有 `paraformer-realtime-v2`，WebSocket 接口
- 优点：中文 SOTA + 实时
- 缺点：需 Aliyun account + WebSocket + 按使用计费

**建议**：先做方向 C（中文体验最好），W4+ 阶段做。

### 4.3 状态变化

- W3 现在的 `transcript.final` 事件要拆成 `transcript.partial`（每次 VAD 窗口出字就推）和 `transcript.final`（段结束时）
- VAD 切段逻辑保留（VAD 决定"段边界"）
- ASR 改成在段进行中增量处理音频

**工作量**：1-2 天

---

## 5. P1：手动停止 / 取消

### 5.1 目标

现在录音只有"VAD 自动结束"或"达到上限时长被强杀"两种结局。加：
- **"停止"按钮**：用户主动结束当前段，触发立即 ASR
- **"取消"按钮**：用户主动扔掉当前段，不 ASR，直接重置

### 5.2 设计草案

- sidecar 新增 `recording.stop` / `recording.cancel` 两个 request
- Renderer 录音中状态显示三个按钮：停止（✓） / 取消（✗） / 让 VAD 自动
- 用全局热键（§2.2）的"再按一次"作为隐式的"停止"

**工作量**：0.25 天

---

## 6. P1：segment 复制按钮

极简：每段右侧加一个复制 icon，点一下把 `transcript.text` 写到剪贴板。

`navigator.clipboard.writeText(text)` 一行调用。

**工作量**：0.1 天

---

## 7. P1：麦克风设备选择

### 7.1 现状

sidecar 默认用 cpal 的 default input device，UI 看不到选择。

### 7.2 设计草案

1. sidecar 暴露 `enumerate input devices`（用 cpal `host.input_devices()`）
2. `state` 响应增加 `input_devices: { id, name }[]`
3. Renderer 在 STT 设置区加一个"输入设备"下拉
4. `recording.start` 接受 `device_id` 参数（sidecar 改用 `StreamConfig { device: ... }`）

**工作量**：0.5 天

---

## 8. P2：本地 ASR 兜底

### 8.1 目标

云端 STT 失败/超时时，自动切到本地 Whisper.cpp，让"语音输入"在断网/欠费/限流时仍能用。

### 8.2 设计草案

- sidecar 启动时同时拉 `whisper-tiny.en` + `whisper-tiny.zh`（共 ~150 MiB，可选）
- `voice:transcribe` IPC 接受 `mode: 'cloud' | 'local' | 'auto'`
- `auto` 默认行为：先云端，失败/超时（>5s）后切本地
- 本地模式是同步的，结果质量比云端差但胜在零依赖

### 8.3 阻塞

- 之前 sherpa-onnx（甚至 ONNX Runtime）走 C++ 时都遇到 libclang / native 编译问题
- whisper.cpp 的 Rust binding（`whisper-rs`）也是 C++ 包装
- 第一个 native binary 编译问题可能得花半天治

**工作量**：2-3 天（其中 0.5-1 天是 native build 环境）

---

## 9. P2：自定义词汇表

### 9.1 目标

让特定专有名词（项目名、人名、术语）能正确识别。例如：
- 默认："prompt lab" → 用户期望："prompt-lab"
- 默认："clip" → 用户期望："Klip"
- 默认："Mavis" → 用户期望："Mavis"

### 9.2 设计草案

- 在 STT 设置面板加一个"自定义词汇表" textarea（每行一个）
- 拼接成 OpenAI 的 `prompt` 参数（≤ 224 tokens），拼成 DashScope 的 `vocabulary_id`
- 跨段复用 prompt 直到用户改

### 9.3 限制

- OpenAI Whisper 的 prompt 对纠正专有名词效果有限（仅 +5-15% 准确率）
- 真要准得用 n-best + 自训练 N-gram LM，超出本插件范围

**工作量**：0.5-1 天

---

## 10. P2：语音命令

### 10.1 目标

说"新行" → 输入 `\n`，说"句号" → 自动加 `.`，说"删掉" → 退格。

### 10.2 设计草案

- 命令集（默认）：

  | 触发词 | 动作 |
  | --- | --- |
  | 新行 / 换行 | `\n` |
  | 新段落 | `\n\n` |
  | 句号 / 句点 | `.`（如果末尾不是标点） |
  | 逗号 | `,` |
  | 问号 | `?` |
  | 叹号 | `!` |
  | 冒号 | `:` |
  | 删掉 / 删除 | 退格 1 次 |
  | 删掉那句话 | 退格到上一个标点 |
  | 撤销 | `Ctrl+Z` |

- 在 ASR 输出的 `text` 上做后处理（正则替换）
- 用户可加自定义命令

**工作量**：1-1.5 天

---

## 11. P2：历史搜索

### 11.1 目标

把 `transcript.final` 全部落 SQLite（不要只保留最近 20 段），加一个搜索 tab 按时间 / 内容 / 路径查。

### 11.2 设计草案

- 新建 `voice_transcripts` schema：`id, text, audio_path, created_at, language, model`
- `transcript.final` 事件触发 INSERT
- 新 tab "历史"：`dbGetSetting` + `dbSearch`（全文用 FTS5，prompt-lab 已有）
- 点击 row 弹出"复制 / 注入 / 删除"菜单

**工作量**：0.5-1 天

---

## 12. P2：多段合并

### 12.1 目标

现在 VAD 用 `MIN_SILENCE_MS = 500`，用户在一句话内短暂停顿（如思考用）会被切成两段，ASR 出来两段文字不连贯。

### 12.2 设计草案

**方案 A（调参）**：把 `MIN_SILENCE_MS` 提到 1000-1500ms。简单但有副作用——真的想分两段的时候（"今天 4 点开会" 跟 "明天 5 点") 也会被合并。

**方案 B（后处理）**：保留 500ms 切段，ASR 出结果后看相邻 segment 的时间间隔 + 语义（用 chat LLM 判断要不要合并）。复杂。

**建议**：先做方案 A，标 1.5s 默认；用户反馈再优化。

**工作量**：0.5 天

---

## 13. P3 列表（按 ROI 排）

| 项 | 价值 | 工作量 | 备注 |
| --- | --- | --- | --- |
| 英文 UI i18n | 国际化必备 | 0.5 天 | prompt-lab 还没 i18n 框架，可能要顺便引入 |
| 多机同步转写历史 | 重度用户需要 | 1-2 天 | 需云存储 / 端到端加密协议 |
| Cost tracking | 用云端必看 | 0.25 天 | segment 时长 × 单价，按月累计 |
| 系统托盘 | 长会话用户 | 0.5 天 | Electron Tray |
| Audio ducking | 录屏会议场景 | 0.5-1 天 | Windows 端需 Win32；macOS 限制大 |

---

## 14. 设计待决策（需用户确认）

| 决策点 | 选项 | 我倾向 |
| --- | --- | --- |
| 全局热键 | `Ctrl+Shift+Space` / `Ctrl+Shift+V` / `F12` / 自定义 | `Ctrl+Shift+Space`（不与现有快捷键冲突） |
| 文字注入方式 | 剪贴板 + Ctrl+V / `SendInput` / AppleScript | 剪贴板 + Ctrl+V（最稳，副作用小） |
| VAD MIN_SILENCE_MS | 500 / 1000 / 1500ms | 1000ms（先一版默认，用户反馈再调） |
| STT fallback 触发 | 5s 超时 / 401 / 全部错误 | 5s 超时 + 401 立即 fallback |
| 默认 STT model | `whisper-1` / `paraformer-v2` | `whisper-1`（双语通用） |
| 麦克风采样率 | 16kHz（强制）/ 48kHz（原生） | 16kHz 强制（与 VAD/ASR 输入匹配，避免重复采样） |

---

## 15. 测试清单（每个 W_k 完成时跑一遍）

```bash
# Rust sidecar build
cd prompt-lab/native/voice-engine
cargo build --release  # 必须 0 error

# Sidecar 独立烟测（真麦克风，VAD 切段）
$bin = "./target/release/nwd-voice-engine.exe"
$env:NWD_VOICE_STORAGE_DIR = "D:/tmp/voice-test"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $bin; $psi.Arguments = "daemon"
# ... 输入 {"type":"recording.start","duration_secs":10} 等等
# 验证：听到 speech.start / 一串 audio.level / speech.end / WAV 文件

# TS typecheck + lint
cd prompt-lab
npm run typecheck  # 0 error
npm run lint        # 0 error（pre-existing 不算）
npm run check:ipc   # voice:* 全部配对
```

**端到端冒烟（每次 W_k 必跑）**：
1. 启动 dev server
2. 进 voice-input 面板
3. 填一个能用的 STT key
4. 点开始 → 说话（"今天 4 点开会"）→ 松手
5. 看到绿底文字
6. （W4 起）按全局热键 → 文字出现在其他 App 输入框
