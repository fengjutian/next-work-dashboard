# nwd-admin 架构与技术说明

本文描述仓库当前实现，不包含尚未落地的功能。使用和 API 示例见 [`README.md`](./README.md)。

## 1. 服务定位

`nwd-admin` 是 next-work-dashboard 的插件目录和分发服务，职责包括：

1. 服务端渲染公开落地页和插件管理页。
2. 接收并验证 `.nwd` 插件包。
3. 保存插件元数据及包内容。
4. 向客户端提供插件列表和下载接口。
5. 记录累计下载次数和最近发布统计。

它目前不是完整的多用户插件市场：没有账户系统、审批、版本历史或对象存储。

## 2. 技术栈

| 层 | 当前选择 | 说明 |
|---|---|---|
| 语言 | Go 1.22+ | 单服务、静态模板嵌入、标准库 HTTP 能力 |
| 路由 | chi v5 | 轻量路由与标准中间件 |
| 页面 | `html/template` | 服务端渲染，自动进行 HTML 上下文转义 |
| 样式 | 本地内嵌 CSS | 不依赖 Tailwind、HTMX、Alpine 或外部 CDN |
| 交互 | 原生 JavaScript | 上传面板切换和删除请求 |
| 数据库 | SQLite | 单节点低运维存储 |
| ORM | GORM | 模型映射、查询和 `AutoMigrate` |
| 配置 | Viper | 默认值、YAML 文件和环境变量 |
| 日志 | `log/slog` | JSON 或文本格式输出到标准错误 |
| 构建 | Go + CGO | `go-sqlite3` 需要 C 编译器 |

## 3. 目录结构

```text
nwd-admin/
├── main.go                         # 配置、依赖组装、路由和服务生命周期
├── config.yaml                     # 示例配置
├── go.mod
├── go.sum
├── README.md                       # 使用、配置和 API 文档
├── TECH_STACK.md                   # 本文
└── internal/
    ├── config/config.go            # Viper 配置加载
    ├── db/sqlite.go                # SQLite 初始化、PRAGMA、迁移
    ├── handler/handler.go          # 页面、API、上传校验和模板渲染
    ├── model/plugin.go             # Plugin 数据模型
    ├── repository/
    │   ├── repository.go           # 仓储接口
    │   └── gorm.go                 # GORM 实现
    ├── service/plugin.go           # 插件业务服务和统计聚合
    └── view/
        ├── embed.go                # 嵌入 HTML 模板
        ├── layout.html             # 页面骨架
        ├── components.html         # 公共组件和 CSS
        ├── home.html               # 公开落地页
        └── plugins.html            # 插件管理页
```

## 4. 请求链路

```text
HTTP request
    │
    ▼
chi router + Logger/Recoverer/RealIP
    │
    ▼
handler
    │
    ▼
PluginService
    │
    ▼
PluginRepository (GORM)
    │
    ▼
SQLite
```

页面模板在编译期嵌入二进制。公共布局在进程启动时解析，具体页面在渲染时克隆布局并解析。

## 5. HTTP 路由

路由定义集中在 `main.go`：

| 方法 | 路径 | 响应 |
|---|---|---|
| `GET` | `/` | HTML 落地页 |
| `GET` | `/plugins` | HTML 管理页 |
| `GET` | `/api/plugins` | JSON 插件列表 |
| `POST` | `/api/plugins` | multipart 上传，成功后 303 跳转 |
| `GET` | `/api/plugins/{id}/download` | `.nwd` 文件 |
| `DELETE` | `/api/plugins/{id}` | JSON 操作结果 |

项目当前没有插件详情页和 `PUT` 更新接口。相同 ID 的上传通过仓储 `Save` 更新现有记录。

## 6. 数据模型

`Plugin` 的主要字段：

| 字段 | 用途 |
|---|---|
| `id` | 插件唯一标识和主键 |
| `name`、`version`、`author` | manifest 元数据 |
| `description`、`icon_emoji` | 页面展示信息 |
| `tags` | JSON 数组字符串，当前页面未使用 |
| `bundle` | 完整 `.nwd` 文件 BLOB |
| `size_bytes` | 插件包字节数 |
| `downloads` | 累计下载次数 |
| `created_at`、`updated_at` | GORM 时间戳 |

数据库初始化执行：

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

随后由 `AutoMigrate(&model.Plugin{})` 维护表结构。

## 7. 上传安全边界

上传处理分为四层：

1. `http.MaxBytesReader` 限制整个请求体。
2. `io.LimitReader` 限制实际插件内容为 2 MB。
3. 文件名必须以 `.nwd` 结尾。
4. JSON 内容按照客户端导入器规则校验。

校验覆盖格式版本、插件 ID、语义版本、API 版本、Sandbox 运行时、权限集合、非空脚本及 style 类型。

这些校验只能保证格式兼容，不能证明插件脚本可信。插件仍必须由客户端在受限 Sandbox 中运行。

## 8. 运行与关闭

HTTP 服务配置读取、写入和空闲超时。进程收到 `SIGINT` 或 `SIGTERM` 时：

1. 创建 5 秒关闭上下文。
2. 停止接收新请求。
3. 等待进行中的请求结束。
4. 关闭底层数据库连接。

日志默认使用 JSON 格式写入 stderr，适合由 systemd、Docker 或日志代理收集。

## 9. 构建约束

当前使用 `gorm.io/driver/sqlite`，其底层依赖 `github.com/mattn/go-sqlite3`。因此构建必须启用 CGO：

```bash
CGO_ENABLED=1 go build -trimpath -o nwd-admin .
```

交叉编译时需要目标平台对应的 C 工具链。若未来需要纯 Go 静态交叉编译，应先评估并迁移到纯 Go SQLite 驱动。

## 10. 已知风险与演进方向

### P0：公开部署前

- 管理员认证与授权
- 上传和删除操作的 CSRF 防护
- HTTPS、限流和安全响应头
- 上传、覆盖、删除操作审计

### P1：插件仓库能力

- 独立的插件版本表和回滚能力
- 插件详情、搜索、分页和审核状态
- SHA-256 校验和与签名验证
- 稳定版、测试版等发布通道

### P2：规模化分发

- 插件包迁移至 S3、MinIO 等对象存储
- CDN 下载和短期签名地址
- 异步下载统计及去重
- 数据库迁移版本管理、监控和健康检查

建议在身份验证完成前，仅将服务部署在本机、VPN 或受信任反向代理之后。
