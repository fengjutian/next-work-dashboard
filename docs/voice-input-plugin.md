---
layout: default
title: "Voice Input · 本地语音输入 + 云端转文字 插件"
---

# Voice Input · 本地语音输入 + 云端转文字 插件

Voice Input 是 prompt-lab 的内置插件，做**系统级本地语音输入**：用户按住热键（或点面板）→ 麦克风拾音 → 边录边出文字 → 把文字注入到光标所在位置。**完全本地的 VAD 切段 + 完全可换的云端 ASR**，模型不下载到本机。

本文档描述已完成能力、模块布局、协议边界与运行约束；剩余工作见 [voice-input-remaining-features.md](./voice-input-remaining-features.md)。

---

## 1. 系统组成

```
┌──────────────────────────────────────────────────────────────────┐
│  prompt-lab (Electron Desktop)                                  │
│  ┌──────────────────────────┐    ┌────────────────────────────┐  │
│  │  Renderer                │    │  Main                      │  │
│  │  ┌────────────────────┐  │    │  ┌──────────────────────┐  │ │
│  │  │ VoiceInputPanel   │  │    │  │ voice-engine-service  │  │ │
│  │  │ (React + zustand) │  │    │  │ (spawn / IPC / STT)  │  │ │
│  │  └─────────┬──────────┘  │    │  └──────────┬─────────────┘  │ │
│  │            │ voice:*     │    │             │ voice:transcribe │
│  │            │ preload     │    │             │   (cloud STT)    │ │
│  │            │ bridge      │    │             │                  │ │
│  │            ▼             │    │             │ POST /audio/     │ │
│  │  window.nwd.voice.*     │◄──►│             │   transcriptions  │ │
│  │  + voice:event          │    │             │                  │ │
│  └──────────────────────────┘    │             │                  │  │
│                                  │             │                  │  │
│                                  │  spawn      │                  │  │
│                                  │  ┌──────────▼─────────────┐    │  │
│                                  │  │ nwd-voice-engine.exe   │    │  │
│                                  │  │ (Rust sidecar)         │    │  │
│                                  │  │  cpal + Silero VAD     │    │  │
│                                  │  │  ring buffer + WAV     │    │  │
│                                  │  └────────┬────────────────┘    │  │
│                                  └───────────┼────────────────────┘  │
└──────────────────────────────────────────────┼───────────────────────┘
                                               │ microphone
                                          ┌────▼─────┐
                                          │  Mic     │
                                          └──────────┘
```

| 组件 | 位置 | 角色 |
| --- | --- | --- |
| Rust sidecar | `prompt-lab/native/voice-engine/` | 麦克风采集、Silero VAD 切段、每段写 WAV |
| Main 进程服务 | `prompt-lab/src/plugins/voice-input/backend/voice-engine-service.ts` | sidecar 生命周期、IPC 转发、**云端 STT 调用** |
| Renderer 面板 | `prompt-lab/src/plugins/voice-input/VoiceInputPanel.tsx` | UI、状态展示、STT 配置 |
| Store | `prompt-lab/src/plugins/voice-input/voice-store.ts` | zustand 状态、STT 配置持久化、`speech.end` 侧击 transcribe |

---

## 2. 已完成功能

### 2.1 Rust sidecar（`nwd-voice-engine`）

- **cpal 16kHz mono PCM 采集** + 48kHz 立体声自动降采样
- **Silero VAD v4 模型**（`x` / `h` / `c` → `prob` / `new_h` / `new_c` schema，512-sample 窗口 = 32ms）
  - 模型来源：`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx`
  - 首次启动自动下载到 `<userData>/voice-engine/models/`
- **端点检测**：hysteresis（start=0.5, end=0.35）+ minimum speech/silence 时长约束
- **Preroll 200ms**：speech.start 触发时把 preroll 缓冲拼到 segment 头部，避免吞字
- **每段写 WAV**：16-bit PCM mono 16kHz，文件名 `speech-YYYYMMDD-HHMMSS-mmm.wav`
- **JSONL RPC** via stdin/stdout；事件流：
  - `ready` / `pong` / `state` / `models`
  - `recording.started` (mode: `raw` | `vad`)
  - `audio.level` 每 50ms（rms / speech_prob / in_speech / written_frames）
  - `speech.start` / `speech.end`（VAD 切段事件）
  - `error`
- **C++ ABI 锁定**：`ort = "=2.0.0-rc.9"`（rc.13 的 ureq TLS regression 让 native lib 下载断流）
- **W1 的原始 recorder 保留**（`recording.raw` 入口），仅作 debug 入口
- **48 KiB 已 verified**：W1 烟测 2 秒 WAV 64 KiB = 16kHz × 2s × 2B，对得上

### 2.2 Main 进程服务（`voice-engine-service.ts`）

- 启动 sidecar（warm-up in `startVoiceDaemon()`）
- 解析 sidecar stdout JSONL，转化为 `VoiceEvent` 广播给所有 BrowserWindow
- 处理 IPC：`voice:start` / `state` / `ping` / `request-state` / `request-models` / `start-recording` / `list-recordings` / `on-event` / `transcribe`
- **STT 调用**（`voice:transcribe`）：读取 WAV → multipart POST 到 `${baseUrl}/audio/transcriptions` → 返回 `{ ok, text }` 或 `{ ok: false, status, error }`
  - 强制 HTTPS 防被滥用为通用代理
  - 60s 超时
  - Bearer token auth（OpenAI 兼容）

### 2.3 Renderer 面板（`VoiceInputPanel.tsx`）

- 实时电平条 + VAD 说话概率条 + 录音进度条
- "VAD 模型就绪 / 缺失" 状态徽章
- "STT 已配置 / 未配置" 状态徽章
- "语音段 + 转写" 列表：每段显示 WAV 路径、时长，转写中显示"转写中…"，成功显示绿底文字，失败显示红底错误
- STT 设置面板（默认折叠）：OpenAI Whisper / 阿里云 DashScope 两个 preset 按钮 + 手动输入 baseUrl / apiKey / model / language
- 模型名独立于 `aiApi.model`（chat model 不会被强制改）

### 2.4 持久化

- STT 配置：`dbSetSetting('voice.sttConfig', ...)`，含 baseUrl / apiKey / model / language
- VAD 模型：on-disk in `<userData>/voice-engine/models/silero_vad.onnx`
- per-segment WAV：on-disk in `<userData>/voice-engine/speech-*.wav`

---

## 3. IPC 协议

### 3.1 Renderer → Main（invoke）

| Channel | Payload | Returns |
| --- | --- | --- |
| `voice:start` | — | `VoiceState` |
| `voice:state` | — | `VoiceState`（本地缓存） |
| `voice:ping` | — | `true` |
| `voice:request-state` | — | sidecar `state` 响应 |
| `voice:request-models` | — | sidecar `models` 响应（`vad.path` / `exists` / `ready`） |
| `voice:start-recording` | `durationSecs: number` | `{ duration_secs: number }` |
| `voice:list-recordings` | — | `VoiceRecording[]` |
| `voice:transcribe` | `{ audioPath, baseUrl, apiKey, model, language? }` | `{ ok: true; text; language? } \| { ok: false; status; error }` |
| `voice:on-event` | — | `true`（订阅用，本侧不下发） |

### 3.2 Main → Renderer（`voice:event`）

事件类型见 `voice-types.ts::VoiceEvent`，关键事件：
- `ready` / `state` / `models` / `pong`
- `recording.started` / `recording.finished` / `recording.progress`
- `audio.level`（VAD-aware 新 shape）
- `speech.start` / `speech.end`（VAD 切段）
- `error`

### 3.3 Sidecar → Main（stdin/stdout JSONL）

见 `native/voice-engine/src/protocol.rs`，关键事件同 §3.2 但字段名带 `vad_model_path` 等扩展。

---

## 4. 已知限制

### 4.1 W3 验证状态

- ✅ Rust sidecar 端到端跑通（真麦克风 → 4 段语音切出来）
- ✅ TS 端 `voice:transcribe` 代码实现，typecheck/lint 干净
- ⚠️ **没有用真实 API key 端到端验证过**——需要用户填一个能用的 OpenAI 兼容 key 跑一次才算闭环
- ⚠️ STT 错误处理只覆盖了"401 / 502 / timeout"，没覆盖 rate-limit 自动重试

### 4.2 ASR 选择

- 当前只走 **云端 OpenAI 兼容 STT**（Whisper / Paraformer / 兼容端点）
- 没有任何**本地** ASR 兜底——断网就用不了
- 没有任何**流式 partial transcript**——只能"说完整段 → 出整段文字"，延迟体感是"段长"

### 4.3 输入路径

- 当前只有**手动点面板**开始录音
- 没有**全局热键**（Ctrl+Shift+V 这种）—— 切到目标输入框之前必须先回 panel
- 没有**自动注入到光标位置**——出文字后还要手动复制粘贴

### 4.4 录制交互

- "开始录音"按钮依赖 `vadReady && sttConfigured`，否则禁用
- 上限时长（2/5/10s）作为兜底（VAD 不停时强制结束）
- 没有**手动停止**按钮（除了等上限）
- 没有**取消当前段**的操作

### 4.5 错误恢复

- sidecar 崩溃会自动 scheduleRestart（指数退避，上限 30s）
- STT 失败只显示错误文案，不自动重试
- 没有**降级**（如云端挂了切本地 Whisper）

### 4.6 UI

- segment 列表最长 20 条
- 没有按时间/路径搜索
- 没有"复制"按钮
- 没有"编辑后再注入"流程

---

## 5. 运行约束

| 项 | 值 |
| --- | --- |
| Rust 工具链 | stable ≥ 1.70（voice-engine Cargo.toml rust-version 不限） |
| Node | ≥ 18（用了 native `FormData` / `Blob` / `fetch`） |
| Electron | 35（prompt-lab 当前固定） |
| 操作系统 | Windows / macOS / Linux（cpal 跨平台） |
| 网络 | 首次启动下载 VAD 模型 ≈ 643 KiB；每次录音后 STT HTTPS 调用 |
| 磁盘 | sidecar 二进制 ≈ 22 MiB（release build） |
| 麦克风 | 默认设备；UI 暂未暴露切换 |

---

## 6. 测试矩阵

| 层 | 测试 | 状态 |
| --- | --- | --- |
| Rust sidecar | `cargo build --release` 干净 | ✅ |
| Rust sidecar | 真麦克风 VAD 切段（W2 烟测） | ✅ |
| TS 主进程 | `npm run typecheck` 干净 | ✅ |
| TS 主进程 | `npm run lint` 干净（pre-existing 错误已隔离） | ✅ |
| TS 渲染 | STT 配置 / segment 列表 / 状态徽章 | ✅ 静态 |
| 端到端 | VAD + STT + UI 显示文字 | ⚠️ 待用真实 key 验证 |

---

## 7. 模块地图

```
prompt-lab/
├── native/voice-engine/                  # Rust sidecar
│   ├── src/
│   │   ├── main.rs                       # entry, subcommand routing
│   │   ├── audio.rs                      # cpal capture + resample
│   │   ├── protocol.rs                   # JSONL request/response
│   │   ├── daemon.rs                     # stdin reader, request dispatch
│   │   ├── model_manager.rs              # silero_vad.onnx download
│   │   ├── vad_inference.rs              # ONNX VAD inference (ort 2.0 rc.9)
│   │   ├── vad_processor.rs              # streaming VAD state machine
│   │   └── recorder.rs                   # W1 dumb recorder (debug)
│   ├── Cargo.toml                        # ort = 2.0.0-rc.9, ndarray feature
│   └── scripts/
│       ├── build-voice-engine.mjs        # cargo build → target/release
│       └── smoke-voice-engine.ps1        # W1 standalone smoke
│
├── src/plugins/voice-input/              # Electron plugin
│   ├── VoiceInputPanel.tsx               # UI
│   ├── voice-store.ts                    # zustand store + STT config persistence
│   ├── index.ts                          # plugin registration
│   └── backend/
│       ├── voice-types.ts                # protocol types
│       └── voice-engine-service.ts       # sidecar lifecycle + STT IPC
│
├── src/main/ipc-handlers.ts              # setupVoiceIPC() + startVoiceDaemon()
├── src/preload.ts                        # window.nwd.voice.*
└── src/types/electron.d.ts               # VoiceApi re-export
```
