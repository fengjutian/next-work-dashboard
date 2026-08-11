# MyCast · 局域网手机投屏 + 文件传输 插件

> 在同一局域网内，把手机的屏幕/摄像头/文件投到这台 prompt-lab 桌面工作台。**零云服务、零中继、纯 P2P**。

---

## 概览

| 维度 | 选型 |
| --- | --- |
| 桌面端技术栈 | Electron + React + TypeScript（prompt-lab 插件） |
| 本地核心 | Rust sidecar (`nwd-mycast.exe`)，通过 stdin/stdout JSONL 与 Electron Main 通信 |
| 网络 | HTTP (axum) + WebSocket (axum-ws) + mDNS (`mdns-sd`) |
| 信令 | WebRTC offer/answer/ICE 透传（视频流在 renderer 里用 Chromium 原生 WebRTC 接收） |
| 移动端 | 二选一：① `mycast-share` Flutter App（投屏 + 文件）；② 内置 Web UI（仅文件传输，投屏请用 App） |
| 安全 | 一次性 6 位配对码 → 升级为长生命周期 session token → 后续 API Bearer 鉴权 |
| 协议文件 | Rust sidecar → Electron Main (JSONL RPC)，HTTP/WS → 手机 (JSON / 文本帧) |

---

## 模块布局

```
prompt-lab/
├── native/mycast/                ← Rust sidecar (独立 cargo project)
│   ├── Cargo.toml
│   ├── build.log                 ← 编译日志
│   ├── web/
│   │   └── index.html            ← 移动端 Web UI (编译期嵌入二进制)
│   └── src/
│       ├── main.rs               ← entry + CLI flags 解析
│       ├── daemon.rs             ← 编排：HTTP + WS + mDNS + RPC 循环
│       ├── config.rs             ← 设备信息 / 端口 / 存储目录 / overrides
│       ├── protocol.rs           ← parent ↔ sidecar 的 JSONL RPC
│       ├── state.rs              ← 共享状态
│       ├── security.rs           ← 配对 token + SHA-256
│       ├── signaling.rs          ← WebRTC 信令转发
│       ├── transfer.rs           ← 上传元数据 + 流式 SHA-256
│       ├── http.rs               ← axum 路由 + 鉴权 + WebSocket
│       └── mdns.rs               ← _nwd-mycast._tcp.local 注册
├── resources/mycast/             ← build 产物（被打进 .exe）
│   └── nwd-mycast.exe
├── scripts/
│   ├── build-mycast.mjs          ← cargo build --release + 复制到 resources
│   ├── test-mycast-rpc.mjs       ← 基础 RPC 烟雾测试
│   └── e2e-mycast.mjs            ← 端到端验证（8 个 section，22 项检查）
└── src/plugins/mycast/           ← Renderer / TS 后端
    ├── index.ts
    ├── MyCastPanel.tsx           ← 主面板：4 个 tab (Home/Devices/Screen/Files)
    └── backend/
        ├── mycast-service.ts     ← spawn sidecar + IPC handlers
        └── mycast-types.ts       ← 类型契约 (MyCastApi)

../mycast-share/                  ← Flutter 移动端（Android MVP + iOS skeleton）
└── lib/
    ├── pairing/                  ← QR 解析、device profile、配对页
    ├── signaling/                ← WebSocket 信令客户端
    ├── casting/                  ← libwebrtc 投屏（MVP 用前置摄像头）
    ├── transfer/                 ← 文件上传/下载
    └── settings/                 ← 设置页 + 本地存储
```

---

## 端到端流程

### 桌面端启动

```text
Electron Main (启动)
  └── setupMyCastIPC() 注册到 ipc-handlers.ts
  └── mycast-service.start()
      └── spawn nwd-mycast.exe daemon (默认 17890/17891，可 CLI 覆盖)
          └── daemon 启动 HTTP+WS+RPC 循环
              └── 发出 ready 事件（带 pair_code, lan_addr, device_id, ...）
                  └── Electron Renderer 收到 → 渲染 QR / 设备卡
```

### 配对 + 投屏

```text
1. 桌面端「Home」tab 显示 QR（内嵌 mycast://pair?host=...&httpPort=...&wsPort=...&code=...）
   - 用户点「生成配对码」/ 启动时自动生成（5min TTL，单次使用）

2. 用户在手机上：
   路径 A：用 mycast-share App 扫码 → 解析 deep link → 自动完成配对
   路径 B：用浏览器扫码 → 跳到 http://<PC_IP>:17890/ → 输入 6 位码完成配对

3. 配对流程（统一 6 位码）：
   POST /api/pair/request { device_id, device_name, platform }
     → { pair_code, expires_in_ms }                    // 触发一次新配对码
   POST /api/pair/complete { device_id, device_name, pairing_code }
     → { session_token, ws_url, http_url }             // 凭 6 位码换 token
   - session_token: 用于后续 /api/files、/ws 鉴权

4. WebSocket 连接（ws://<PC_IP>:17890/ws，单端口同 HTTP）：
   - 鉴权两种方式：
     ① Sec-WebSocket-Protocol: bearer, <token>（手机浏览器/老客户端）
     ② Authorization: Bearer <token>（Node ws、桌面测试）
   - 首帧必须是 hello { device_id, device_name, platform }
   - 后续 create_session / offer / answer / ice / stream_start / stream_stop

5. WebRTC 双向 SDPC/ICE 转发：
   手机 offer  → 服务端透传 webrtc.offer 事件 → Electron Main
     → Renderer 创建 PeerConnection → 收 answer → send_to_phone 推回
   服务端是纯 relay；视频流直接 P2P（SRTP/ICE）从手机到 Chromium
```

### 文件传输

```text
1. 手机 multipart upload → POST /api/files/upload (Authorization: Bearer ...)
   - 字段：filename, size, file
   - 服务端流式写盘 + 实时 SHA-256 + transfer 进度
   - 完成后返回 { sha256, size, speed_bps, record }

2. 桌面端 GET /api/files 列出已上传文件（按 mtime 倒序）
   点击文件 → 浏览器下载 GET /api/files/download/<id>
```

---

## 安全模型

| 层级 | 机制 |
| --- | --- |
| 配对入口 | 6 位数字配对码（5min TTL、单次使用）→ 升级为长生命周期 session token |
| 上传/下载 | `Authorization: Bearer <session_token>`；`require_session()` 校验 |
| WebSocket | `Sec-WebSocket-Protocol: bearer, <token>` 或 `Authorization: Bearer <token>` |
| mDNS | TXT 记录带 `device_id`，但**不暴露 secret** |
| Token 失效 | pair token 5 分钟过期；session token 跟随 daemon 生命周期 |

> 仍建议在同一受信任局域网（家庭 / 办公 WiFi）使用，不应在公网 / 公共 WiFi 暴露。

---

## HTTP API 一览

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | - | 移动端 Web UI |
| GET | `/api/info` | - | 桌面端元信息、pair_code、LAN 地址 |
| POST | `/api/pair/request` | - | 触发一次新配对码（不消耗） |
| POST | `/api/pair/complete` | - | 凭 6 位码换 session_token |
| GET | `/api/sessions` | - | 桌面端活动信令会话（诊断用） |
| GET | `/api/files` | Bearer | 列出本地存储文件 |
| POST | `/api/files/upload` | Bearer | multipart 上传 |
| GET | `/api/files/download/:id` | Bearer | 下载 |
| GET | `/api/transfers` | Bearer | 传输记录 |
| WS | `/ws` | 可选 Bearer | WebRTC 信令通道（**端口 = http_port**） |

> 注：WS 与 HTTP 跑在同一个 axum server 上（`cfg.http_port`）。`DaemonInfo.ws_port` 字段保留仅为兼容，实际值 = `http_port`。

---

## IPC API（Renderer ↔ Electron Main）

`window.electronAPI.mycast.*`：

```ts
mycast.start()          // 启动 daemon，返回 MyCastState
mycast.state()          // 当前状态
mycast.systemInfo()     // 主机信息
mycast.issuePairing()   // 申请新配对码
mycast.listSessions()   // 活动会话列表
mycast.listTransfers()  // 传输记录
mycast.sendToPhone(deviceId, frame)  // 通过 daemon 转发信令
mycast.endSession(id)   // 结束会话
mycast.cancelTransfer(id)
mycast.onEvent(handler) // 订阅事件
```

事件类型见 `backend/mycast-types.ts`（`MyCastEvent`）。

---

## CLI flags（`nwd-mycast daemon`）

| Flag | 默认 | 说明 |
| --- | --- | --- |
| `--http-port <N>` | 17890 | HTTP + WS 监听端口 |
| `--ws-port <N>` | 27891 | 已废弃（WS 跑在 http-port），保留兼容 |
| `--bind <IP>` | 0.0.0.0 | 绑定地址 |
| `--no-mdns` | 启用 | 关闭 mDNS 广告（多实例隔离、调试用） |
| `--storage-dir <PATH>` | LOCALAPPDATA/nwd-mycast | 文件落地目录 |
| `--device-name <NAME>` | COMPUTERNAME | 显示名 |

E2E 测试使用 `--http-port 27890 --ws-port 27891 --no-mdns --device-name E2E Sidecar`，避免跟 dev Electron 占用的 17890 冲突。

---

## 编译 & 启动

```bash
cd prompt-lab
npm run build:mycast     # 编译 Rust sidecar，产物落到 resources/mycast/
npm start                # 完整链路：prepare + 4 个 native + electron-forge start
```

`npm start` 会依次构建 `rag-worker / disk-scanner / net-probe / mycast` 然后启动 Electron。

### 端到端验证（E2E）

```bash
cd prompt-lab
npm run build:mycast                       # 先编译
node scripts/e2e-mycast.mjs                # 跑 8 个 section、22 项检查
```

E2E 用独立端口（27890/27891 + 关闭 mDNS）避免跟 dev Electron 冲突。覆盖：

| Section | 内容 |
| --- | --- |
| 1 | spawn sidecar + 等待 ready 事件 + 验证 lan_addr / pair_code |
| 2 | HTTP `/api/info` 元信息 |
| 3 | pair_request + pair_complete 配对全流程 |
| 4 | Bearer 鉴权：未带 token / 错误 token → 401 |
| 5 | 上传 32KB 随机文件 → 列表 → 下载 → SHA256 byte-compare |
| 6 | 配对码单次使用：重用 → 401，错码 → 401 |
| 7 | WebSocket 信令：hello + create_session + offer → 监听 webrtc.offer 事件 → send_to_phone 推 answer → phone 收到 answer |
| 8 | RPC 往返：list_sessions / issue_pairing / list_transfers |

退出码 0 = 22/22 通过；非 0 = 失败 section 数量。

---

## 移动端集成

### Flutter App（`../mycast-share/`）

```bash
cd ../mycast-share
flutter pub get
flutter analyze --no-fatal-warnings --no-fatal-infos
# 真正打包需 Android Studio + JDK + Android SDK：
flutter build apk --release
```

MVP 阶段：
- `lib/casting/casting_service.dart` 用 `Helper.openCamera({facingMode:'user'})` 临时喂一路视频给 libwebrtc，验证信令/SDP/ICE 管道
- 真实 MediaProjection 投屏需要 JNI C++ 桥接 → Phase 2
- iOS 端只 `flutter create` 出骨架，未实现 ReplayKit

### 内置 Web UI（`web/index.html`）

- 投屏 tab 已替换为「请安装 MyCast App」提示
- 配对 + 文件传输 tab 仍可用（手机浏览器也能完成 LAN 配对 + 传文件）
- 适合没装 App 的同事临时互传文档

---

## 已知边界

- **iOS 端**：当前只有 `flutter create` 骨架，未实现 ReplayKit 录屏（需要 macOS + Xcode）。
- **Android 真投屏**：MVP 用前置摄像头跑通信令/SDP/ICE 管道；真实 MediaProjection 帧 → libwebrtc 需要 C++ JNI 桥（Phase 2）。
- **远程控制**（鼠标 / 键盘回控）：未实现。MVP 阶段只做投屏 + 文件。
- **多设备同时**：服务端允许多 session，但 UI 暂时只渲染一个 active screen。
- **断点续传**：未实现。前端用 `multipart` 一次性上传，大文件可能需要后续改成 chunked upload。
- **STUN/TURN**：纯局域网；ICE 不用服务器候选，后续公网扩展时再加。
- **dev 环境隔离**：E2E 走独立端口（27890/27891）避免跟 `npm start` 抢 17890。

---

## 调试

```bash
# 直接跑 daemon 看日志（HTTP port 17890）
RUST_LOG=info,nwd_mycast=debug ./resources/mycast/nwd-mycast.exe daemon

# 用独立端口（不冲突）
./resources/mycast/nwd-mycast.exe daemon --http-port 27890 --no-mdns --device-name Debug

# 测试 HTTP API
curl http://127.0.0.1:17890/api/info | jq
curl -X POST http://127.0.0.1:17890/api/pair/request \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test","device_name":"Test Phone","platform":"web"}'
```
