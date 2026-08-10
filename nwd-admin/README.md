# NWD Plugin Hub

`nwd-admin` 是 next-work-dashboard 的轻量插件分发服务，提供公开落地页、插件管理页面和 `.nwd` 下载 API。

读接口（落地页、插件列表、下载）始终公开。写接口（上传、删除）默认受 Basic Auth 保护；当未配置管理员凭证时，服务器会发出警告并以"trusted-local"模式运行，仅适合本地网络或受信任环境。

## 功能

- 展示插件数量、累计下载量和最近上架插件
- 浏览、上传、下载和删除插件
- 通过 JSON API 向客户端提供插件列表
- 校验 `.nwd v1` 格式、清单、权限、运行时和脚本
- SQLite 持久化，自动建表并启用 WAL
- 结构化日志、HTTP 超时和优雅退出
- 页面模板与样式嵌入 Go 二进制，不依赖前端 CDN
- 写接口 Basic Auth 保护，bcrypt 密码哈希
- 通用安全响应头（CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy）

## 环境要求

- Go 1.22 或更高版本
- 支持 CGO 的构建环境
- C 编译器（SQLite 驱动 `github.com/mattn/go-sqlite3` 需要 CGO）

Windows 可以使用 MSYS2/MinGW-w64，Linux 通常安装 `gcc` 和 libc 开发包即可。

## 快速启动

```bash
cd nwd-admin
go mod download
go run .
```

默认监听 `http://localhost:8090`，数据库保存在 `./data/nwd-admin.db`。

使用指定配置文件：

```bash
go run . -config ./config.yaml
# 等价于
go run . serve -config ./config.yaml
```

生产构建：

```bash
go build -trimpath -ldflags="-s -w" -o nwd-admin .
```

不要设置 `CGO_ENABLED=0`，当前 SQLite 驱动依赖 CGO。

## 管理员认证

读接口（`/`、`/plugins`、`/api/plugins`、`/api/plugins/{id}/download`）始终公开。写接口（`POST /api/plugins`、`DELETE /api/plugins/{id}`）在配置了管理员凭证后强制 Basic Auth。

未配置凭证时服务以 "trusted-local" 模式启动，**仅适合本机或受信任网络**；启动日志会明确警告。设置凭证后即自动启用保护，**必须配置 username + password_hash 完整配对**——只设一个会被视为未配置。

### 生成密码哈希

```bash
nwd-admin gen-password
# 提示输入并确认明文密码，输出一行 bcrypt 哈希
```

非交互模式（适合脚本）：

```bash
echo 'mypassword' | nwd-admin gen-password -stdin
```

将得到的哈希填到 `config.yaml` 的 `admin.password_hash`：

```yaml
admin:
  username: "admin"
  password_hash: "$2a$12$..."
  realm: "nwd-admin"
```

环境变量等价（同名大写、点号转下划线）：

```powershell
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD_HASH = (echo 'mypassword' | nwd-admin gen-password -stdin)
go run .
```

### 在浏览器中使用

`/plugins` 页面右上角新增了"管理员凭证"按钮：填一次账号密码，服务端会用一条无害的 DELETE 探针校验，成功后凭证仅保存到本会话的 `sessionStorage`，所有后续写请求都会自动带上 `Authorization: Basic ...` 头。关闭标签页即清除，无需依赖浏览器原生的认证弹窗。

`curl` 直接访问写接口：

```bash
curl -u admin:mypassword -F "bundle=@my-plugin.nwd" http://localhost:8090/api/plugins
curl -u admin:mypassword -X DELETE http://localhost:8090/api/plugins/my-plugin
```

## 配置

默认配置见 [`config.yaml`](./config.yaml)：

```yaml
server:
  addr: ":8090"
  read_timeout: 5
  write_timeout: 10
  idle_timeout: 120

database:
  data_dir: "./data"

log:
  level: "info"
  format: "json"

admin:
  username: ""
  password_hash: ""
  realm: "nwd-admin"
```

配置优先级为：环境变量 > 配置文件 > 内置默认值。

当前环境变量名称由配置键直接转换得到：

| 配置键 | 环境变量 | 示例 |
|---|---|---|
| `server.addr` | `SERVER_ADDR` | `:9000` |
| `server.read_timeout` | `SERVER_READ_TIMEOUT` | `10` |
| `server.write_timeout` | `SERVER_WRITE_TIMEOUT` | `30` |
| `server.idle_timeout` | `SERVER_IDLE_TIMEOUT` | `120` |
| `database.data_dir` | `DATABASE_DATA_DIR` | `/var/lib/nwd-admin` |
| `log.level` | `LOG_LEVEL` | `debug` |
| `log.format` | `LOG_FORMAT` | `text` |
| `admin.username` | `ADMIN_USERNAME` | `admin` |
| `admin.password_hash` | `ADMIN_PASSWORD_HASH` | `$2a$12$...` |
| `admin.realm` | `ADMIN_REALM` | `nwd-admin` |

PowerShell 示例：

```powershell
$env:SERVER_ADDR = ':9000'
$env:DATABASE_DATA_DIR = 'D:\data\nwd-admin'
go run .
```

## 页面与 API

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/` | 公开落地页与服务统计 |
| `GET` | `/plugins` | 插件管理页面 |
| `GET` | `/api/plugins` | 获取插件元数据列表 |
| `POST` | `/api/plugins` | 上传并发布 `.nwd` 文件 |
| `GET` | `/api/plugins/{id}/download` | 下载插件包并累计下载次数 |
| `DELETE` | `/api/plugins/{id}` | 删除插件 |

### 获取插件列表

```bash
curl http://localhost:8090/api/plugins
```

响应为插件对象数组。`bundle` 字段不会出现在 JSON 中。

### 上传插件

```bash
curl -F "bundle=@my-plugin.nwd" http://localhost:8090/api/plugins
```

上传成功后返回 `303 See Other` 并跳转到 `/plugins`。相同插件 ID 会更新现有记录；当前数据模型不保留历史版本。

### 下载插件

```bash
curl -OJ http://localhost:8090/api/plugins/my-plugin/download
```

### 删除插件

```bash
curl -X DELETE http://localhost:8090/api/plugins/my-plugin
```

## `.nwd` 格式

`.nwd` 是 UTF-8 JSON 文件，最大为 2 MB。最小可用示例：

```json
{
  "format": "nwd-v1",
  "manifest": {
    "id": "hello-world",
    "name": "Hello World",
    "version": "1.0.0",
    "apiVersion": "1",
    "runtime": "sandbox",
    "permissions": []
  },
  "script": "console.log('hello from NWD')",
  "style": null
}
```

服务端校验规则：

- `format` 必须为 `nwd-v1`
- `manifest.name` 必须为 1–100 个字符
- `manifest.version` 必须是语义版本，例如 `1.0.0` 或 `1.0.0-beta.1`
- `manifest.id` 必须为 2–64 位字母、数字、点、下划线或连字符
- 省略 `id` 时会从插件名称推导
- `apiVersion` 省略或为 `1`
- `runtime` 省略或为 `sandbox`
- `permissions` 必须是数组，且只能包含已知权限
- `script` 必须是非空字符串
- `style` 省略、为 `null` 或字符串

允许的权限：

```text
store.read
clipboard
inject
external.open
data
preview
file.read
file.write
```

客户端侧完整插件规范见 [`../docs/plugin-architecture.md`](../docs/plugin-architecture.md)。

## 数据与升级

服务启动时会在 `database.data_dir` 下创建：

```text
nwd-admin.db
nwd-admin.db-wal
nwd-admin.db-shm
```

GORM `AutoMigrate` 会创建或补充插件表。插件包当前直接以 BLOB 存入 SQLite。备份时应停止写入，或使用 SQLite 的在线备份机制，不建议只复制正在使用的主数据库文件。

## 验证

```bash
go test ./...
go build ./...
```

## 当前限制

- 写接口已加入 Basic Auth，但**没有 CSRF 防护**；浏览器直访需自行处理 CSRF
- 每个插件 ID 只保存一个版本
- 没有分页、搜索、审核流和操作审计
- 插件包存入 SQLite，不适合大规模下载或 CDN 分发
- 下载计数会受到爬虫、重试和预取影响
- 没有请求限流（速率限制）和暴力破解防护

公网部署前仍需加入 HTTPS、CSRF 防护、请求限流、审计日志。

## 相关文档

- [`TECH_STACK.md`](./TECH_STACK.md)：架构、模块边界和技术决策
- [`../docs/plugin-architecture.md`](../docs/plugin-architecture.md)：客户端插件体系与 `.nwd` 规范
- [`../docs/troubleshooting.md`](../docs/troubleshooting.md)：客户端故障排查
