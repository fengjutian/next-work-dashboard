---
layout: default
title: "MyCast · 局域网投屏 + 文件传输 插件"
---

# MyCast · 局域网投屏 + 文件传输 插件

MyCast 是 prompt-lab 的内置可信插件，把同一局域网内的 Android / iOS 手机与桌面端拉成 P2P 通道，实现**屏幕投屏**与**双向文件传输**。**零云服务、零中继、纯局域网**。

本文档描述已完成的能力、模块布局、协议边界与运行约束；剩余工作见 [mycast-remaining-features.md](./mycast-remaining-features.md)。

---

## 1. 系统组成

```
┌──────────────────────┐  HTTP/WS   ┌──────────────────────┐
│  mycast-share        │ ─────────► │  prompt-lab Desktop  │
│  (Flutter Android)   │            │  + Rust sidecar      │
│                      │ ◄───────── │  nwd-mycast          │
└──────────────────────┘  WebRTC    └──────────────────────┘
                                      ▲
                                      │ mDNS (_nwd-mycast._tcp.local)
                                      │
                               ┌──────────────────────┐
                               │  mycast-share        │
                               │  (Flutter iOS 骨架)  │
                               └──────────────────────┘
                                      ▲
                                      │ HTTP（仅文件传输）
                                      │
                               ┌──────────────────────┐
                               │  浏览器              │
                               │  扫码进入移动 Web UI │
                               │  (投屏禁用，文件可用)│
                               └──────────────────────┘
```

| 组件 | 位置 | 角色 |
| --- | --- | --- |
| Rust sidecar | `prompt-lab/native/mycast/` | 协议核心：HTTP + WebSocket + mDNS + JSONL RPC |
| Electron 插件 | `prompt-lab/src/plugins/mycast/` | 4-tab UI、QR 渲染、IPC |
| 移动端 App | `../mycast-share/` | 配对、投屏（MVP 占位）、文件传输 |
| 移动 Web UI | `prompt-lab/native/mycast/web/index.html` | 浏览器扫码进入；仅文件传输 |

---

## 2. 已完成功能

### 2.1 网络与发现

- **mDNS 服务注册**：`_nwd-mycast._tcp.local`，TXT 记录带 `device_id` / `platform` / `ver`，不暴露 secret
- **LAN 地址枚举**：`enumerate_lan_addrs()` 列出本机所有 IPv4/IPv6 地址，挑选最优的作 `lan_addr`
- **HTTP + WebSocket 单端口**：axum 同一 server 监听，端口 17890（默认）

### 2.2 配对流程

```
[Desktop]  MyCast 面板启动
   ↓ spawn sidecar, ready 事件带 pair_code
[Desktop]  渲染 QR：mycast://pair?host=...&httpPort=...&wsPort=...&code=...
[Phone]    扫码 → 解析 deep link / 或浏览器输 6 位码
   ↓ POST /api/pair/request { device_id, device_name, platform }
[Svr]      颁发新 pair_code（5min TTL，单次使用），不消耗
[Phone]    POST /api/pair/complete { device_id, device_name, pairing_code }
[Svr]      校验 → 颁发 session_token
[Phone]    用 session_token 访问 /api/files、/ws
```

### 2.3 HTTP API

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | - | 移动端 Web UI |
| GET | `/api/info` | - | 桌面元信息、pair_code、LAN 地址 |
| POST | `/api/pair/request` | - | 触发新配对码（不消耗） |
| POST | `/api/pair/complete` | - | 凭 6 位码换 session_token |
| GET | `/api/sessions` | - | 桌面活动信令会话（诊断用） |
| GET | `/api/files` | Bearer | 列出本地存储文件 |
| POST | `/api/files/upload` | Bearer | multipart 上传 |
| GET | `/api/files/download/:id` | Bearer | 下载 |
| GET | `/api/transfers` | Bearer | 传输记录 |
| WS | `/ws` | 可选 Bearer | WebRTC 信令通道 |

### 2.4 WebSocket 信令

- 端口同 HTTP（17890）
- 鉴权两种方式（按优先级）：
  1. `Authorization: Bearer <token>`（Node ws、桌面测试）
  2. `Sec-WebSocket-Protocol: bearer, <token>`（legacy 客户端）
- 首帧必须是 `hello { device_id, device_name, platform }`
- 后续帧：`create_session` / `offer` / `answer` / `ice` / `stream_start` / `stream_stop`
- 桌面端通过 `send_to_phone` RPC 推帧到指定 device_id

### 2.5 文件传输

- 上传：multipart `filename` / `size` / `file`，流式写盘 + 实时 SHA-256 + 进度事件
- 下载：`/api/files/download/<id>`，id = sha256(filename)；返回 `Content-Disposition: attachment`
- 存储：默认 Windows `%LOCALAPPDATA%/nwd-mycast/`，可 CLI 覆盖
- 传输记录：内存中保留最近 20 条，含 size / sha256 / speed_bps / elapsed_ms

### 2.6 桌面端 UI

- 4 个 tab：**Home / Devices / Screen / Files**
- Home：QR 码、6 位配对码、设备卡、状态指示
- Devices：已配对设备列表 + 「结束会话」操作
- Screen：`<video>` 元素显示 WebRTC 远端流（libwebrtc 透传）
- Files：手机上传的文件列表 + 浏览器下载
- IPC 入口：`window.electronAPI.mycast.*`（start / state / issuePairing / listSessions / sendToPhone / ...）

### 2.7 移动端 App（`../mycast-share/`）

- Flutter Android MVP + iOS skeleton
- 5 大模块：pairing / signaling / casting / transfer / settings
- 配对：QR 解析（`qr_parser.dart`）、设备 profile、pairing_page
- 信令：WebSocket 客户端（`signaling_client.dart`），支持 hello / offer / ice / stop
- 投屏：libwebrtc 集成（MVP 用前置摄像头占位，详见 §4）
- 文件：HTTP multipart 上传 / 列表 / 下载
- 设置：质量预设、麦克风、自动重连（shared_preferences 持久化）

### 2.8 端到端测试

- `scripts/e2e-mycast.mjs`：8 个 section、22 项检查
- 覆盖：spawn / ready / HTTP 元信息 / pair_request+complete / 鉴权失败 / 上传+下载+SHA256 / 配对码单次性 / WebSocket 全链路 / RPC 往返
- 跑法：`cd prompt-lab && node scripts/e2e-mycast.mjs`
- 用独立端口（27890/27891 + 关闭 mDNS）避开 dev Electron 占用 17890

---

## 3. 安全边界

- **零外联**：所有通信在 LAN 内完成，sidecar 不主动访问公网
- **配对码 5 分钟 TTL、单次使用**：`consume_pairing_by_code` 一旦用就作废
- **session_token 跟随 daemon 生命周期**：daemon 重启 token 失效
- **HTTP 鉴权**：`require_session()` 严格校验 `Authorization: Bearer <token>`，无 token / 错 token 一律 401
- **WebSocket 鉴权**：upgrade 时校验 token，握手失败直接 401
- **mDNS TXT 不暴露 secret**：仅 device_id / platform / ver
- **路径清洗**：`sanitize_filename()` 替换 `/ \ : * ? " < > | \0` 为 `_`，防路径穿越
- **multipart 体量上限**：2 GiB（axum DefaultBodyLimit）

**仍建议**：在同一受信任局域网（家庭 / 办公 WiFi）使用，不应在公网 / 公共 WiFi 暴露 17890 端口。

---

## 4. 当前限制（已记录在册，详见待办文档）

- **Android 投屏为占位实现**：`CastingService._acquireLocalStream` 用 `Helper.openCamera({facingMode:'user'})` 喂前置摄像头进 libwebrtc，验证信令/SDP/ICE 管道。**真实屏幕帧需要 C++ JNI 桥接 MediaProjection → libwebrtc**（Phase 2 工作，详见 `mycast-remaining-features.md`）。
- **iOS 端**：`flutter create` 骨架，未实现 ReplayKit（需 macOS + Xcode）
- **mobile web UI 投屏禁用**：浏览器无法调用 MediaProjection / ReplayKit，cast tab 替换为"请用 App"提示；web UI 仍可完成配对 + 文件传输
- **远程控制（鼠标/键盘回控）**：未实现
- **断点续传**：未实现，大文件需要后续改成 chunked upload

> MVP 阶段（Phase 1）的设计目标：把"如果接上真屏幕帧，画面真能流到桌面"这个推演在硬件上跑通。前置摄像头占位是"信令管道已通"的证据，不是产品交付。

---

## 5. CLI flags（`nwd-mycast daemon`）

| Flag | 默认 | 说明 |
| --- | --- | --- |
| `--http-port <N>` | 17890 | HTTP + WS 监听端口 |
| `--ws-port <N>` | 27891 | 兼容字段（WS 实际跑在 http-port） |
| `--bind <IP>` | 0.0.0.0 | 绑定地址 |
| `--no-mdns` | 启用 | 关闭 mDNS 广告（多实例隔离、调试用） |
| `--storage-dir <PATH>` | LOCALAPPDATA/nwd-mycast | 文件落地目录 |
| `--device-name <NAME>` | COMPUTERNAME | 显示名 |

E2E 跑法：`--http-port 27890 --ws-port 27891 --no-mdns --device-name E2E Sidecar`。

---

## 6. 开发与打包

```bash
# 1. 编译 Rust sidecar
cd prompt-lab
npm run build:mycast           # 产物落到 resources/mycast/nwd-mycast.exe

# 2. 端到端验证
node scripts/e2e-mycast.mjs    # 22/22 验证

# 3. 启动桌面端
npm start                      # prepare + 4 个 native + electron-forge start

# 4. 移动端 App（Android Studio 真机）
cd ../mycast-share
flutter pub get
flutter analyze --no-fatal-warnings --no-fatal-infos
flutter build apk --release    # 需 Android Studio + JDK + Android SDK
```

构建脚本（`scripts/build-mycast.mjs`）将 release 二进制复制到 `resources/mycast/`；Electron Forge 将该目录作为 `extraResource` 打包。开发模式直接从 Rust `target/release` 加载。

---

## 7. 协议契约（关键点速查）

### JSONL RPC（Electron Main ↔ Rust sidecar）

- stdin：父进程发请求，每行一个 JSON
- stdout：子进程发响应/事件，每行一个 JSON
- 请求必须带 `id`；事件 `id = null`
- 响应字段：`{ id, type, ok, ...payload }`
- 事件字段：`{ id: null, type, ...payload }`

### SignalingFrame（WebSocket 文本帧）

```ts
type Frame =
  | { type: 'hello';        device_id; device_name; platform }
  | { type: 'pair';         token; device_id; device_name; platform }
  | { type: 'create_session'; session_id; kind: 'screen' | 'file' | 'discovery' }
  | { type: 'offer';        session_id; sdp }
  | { type: 'answer';       session_id; sdp }
  | { type: 'ice';          session_id; candidate }
  | { type: 'stream_start'; session_id }
  | { type: 'stream_stop';  session_id }
  | { type: 'ping' };
```

### HTTP multipart 上传字段

| 字段 | 说明 |
| --- | --- |
| `filename` | 落地文件名（经 sanitize_filename） |
| `size` | 声明字节数（用于进度预计算） |
| `file` | 二进制内容 |

### 已知 sidecar ↔ parent 事件类型

| type | 含义 |
| --- | --- |
| `ready` | daemon 启动完毕，payload 含 DaemonInfo + pair_code |
| `webrtc.offer` | phone → desktop 转发 SDP |
| `webrtc.answer` | desktop → phone 转发 SDP |
| `webrtc.ice` | 双向 ICE 转发 |
| `session.created` | 桌面端创建/接管会话 |
| `phone.hello` | phone 完成 WS 握手 |
| `phone.pair` | phone 收到 pair token（用于关联设备） |
| `stream.start` / `stream.stop` | 投屏开始/结束 |

---

## 8. 关键文件路径

```
prompt-lab/
├── native/mycast/                          # Rust sidecar 源码
│   ├── Cargo.toml
│   ├── web/index.html                      # 移动 Web UI（编译期 include_str!）
│   └── src/
│       ├── main.rs                         # entry + CLI flags
│       ├── daemon.rs                       # 编排：HTTP + WS + mDNS + RPC
│       ├── config.rs                       # 设备信息 / 端口 / overrides
│       ├── protocol.rs                     # parent ↔ sidecar JSONL RPC
│       ├── state.rs                        # 共享状态
│       ├── security.rs                     # 配对 token + SHA-256
│       ├── signaling.rs                    # WebRTC 信令转发
│       ├── transfer.rs                     # 上传元数据 + 流式 SHA-256
│       ├── http.rs                         # axum 路由 + 鉴权 + WebSocket
│       └── mdns.rs                         # _nwd-mycast._tcp.local 注册
├── resources/mycast/nwd-mycast.exe         # 编译产物
├── scripts/
│   ├── build-mycast.mjs                    # cargo build --release + 复制
│   ├── test-mycast-rpc.mjs                 # 基础 RPC 烟雾测试
│   └── e2e-mycast.mjs                      # 端到端验证（22 项）
└── src/plugins/mycast/
    ├── index.ts
    ├── MyCastPanel.tsx                     # 主面板 4 tab
    ├── README.md                           # 插件子模块说明
    └── backend/
        ├── mycast-service.ts               # spawn sidecar + IPC
        └── mycast-types.ts                 # MyCastApi 类型契约

../mycast-share/                            # Flutter 移动端
├── lib/
│   ├── main.dart
│   ├── app/                                # routes, theme
│   ├── pairing/                            # QR 解析、device profile、配对页
│   ├── signaling/                          # WebSocket 信令客户端
│   ├── casting/                            # libwebrtc 投屏（MVP 占位）
│   ├── transfer/                           # 文件上传/下载
│   └── settings/                           # 设置页 + 本地存储
└── android/app/src/main/
    ├── AndroidManifest.xml                 # mediaProjection 权限、deep link
    └── kotlin/com/nextworkdashboard/mycast/
        ├── MainActivity.kt
        └── capture/                        # 6 个 native 桥接文件
```
