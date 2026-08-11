# NWD Plugin Hub

`nwd-admin` 是 next-work-dashboard 的轻量插件分发服务，提供公开落地页、插件管理页面和 `.nwd` 下载 API。

读接口（落地页、插件列表、下载）始终公开。写接口（上传、删除）默认受 Basic Auth 保护；当未配置管理员凭证时，服务器会发出警告并以"trusted-local"模式运行，仅适合本地网络或受信任环境。

## 功能

- 展示插件数量、累计下载量和最近上架插件
- 浏览、上传、下载和删除插件
- 每个插件 ID 维护历史版本，可下载指定版本或 latest；删单版本自动升级 latest
- 通过 JSON API 向客户端提供插件列表（支持分页 + 关键字搜索 + 标签筛选）
- 校验 `.nwd v1` 格式、清单、权限、运行时、脚本和标签
- 插件标签（manifest.tags）持久化为 JSON 数组，按标签筛选
- SQLite 持久化（双表：plugins 元数据 + plugin_versions 版本内容），自动建表并启用 WAL
- 结构化日志、HTTP 超时和优雅退出
- 页面模板与样式嵌入 Go 二进制，不依赖前端 CDN
- 写接口 Basic Auth 保护，bcrypt 密码哈希
- 通用安全响应头（CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy）
- 每 IP token-bucket 限流（read / write / admin 三档可配）
- 审计日志：所有写操作、认证失败、限流事件全部落表，可视化查看 + JSON 导出
- 审计日志自动按保留天数清理（默认 90 天）
- 可选 TLS：自签证书一键生成 + 静态 cert/key 模式 + Let's Encrypt 自动签发（autocert）

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

## TLS / HTTPS

未启用时 nwd-admin 只监听 HTTP（`server.addr`，默认 `:8090`）。公网部署必须打开 TLS。两种模式互斥：

### 模式 1：静态证书（推荐用于内网或自建 CA）

1. 用内置子命令生成自签证书（开发 / 测试用）：

    ```bash
    nwd-admin gen-cert -host nwd-admin.local,127.0.0.1 -out ./tls -days 365
    # 写入 ./tls/cert.pem 和 ./tls/key.pem
    ```

    生产环境建议用 certbot 或内部 PKI 签发，把生成的 `cert.pem` / `key.pem`（或 fullchain + privkey）放到任意目录。

2. 在 `config.yaml` 启用：

    ```yaml
    server:
      addr: ":8443"
      tls:
        enabled: true
        cert_file: "./tls/cert.pem"
        key_file:  "./tls/key.pem"
        min_version: "1.2"
    ```

3. 启动：

    ```bash
    go run .
    # 🧩 NWD Admin listening on https://localhost:8443
    ```

### 模式 2：Let's Encrypt 自动签发（公网域名）

要求：DNS 已指向本机，且本机 80 端口可达。首次启动会自动签发证书并缓存到 `<data_dir>/acme-cache`。

```yaml
server:
  addr: ":443"
  tls:
    enabled: true
    acme:
      hosts:
        - nwd-admin.example.com
      email: "ops@example.com"
      redirect_http: true   # :80 308 跳转到 https://
```

设置 `staging: true` 可以用 Let's Encrypt 测试环境验证流程不污染正式额度。

### 客户端验证自签证书

自签证书默认会被浏览器 / `curl` 拒绝。两种处理：

- **开发**：浏览器加例外；`curl` 加 `-k`。
- **生产**：把自签 CA 装到系统信任库；或直接用 Let's Encrypt 拿正式证书。

## 数据库迁移

`nwd-admin` 历史上使用单表 `plugins` 存所有元数据 + bundle。当前版本拆分成 `plugins`（元数据）+ `plugin_versions`（每个版本的 bundle）。如果从老版本升级，**直接重启服务会丢失所有 bundle**——GORM 的 AutoMigrate 会把 schema 改成新形状，但旧 plugins 行里的 `bundle` 列会被丢弃。

升级步骤：

```bash
# 1. 停服（避免 AutoMigrate 在你 migrate 之前跑）
systemctl stop nwd-admin

# 2. 备份数据目录
cp -r ./data ./data.bak-$(date +%Y%m%d)

# 3. 先跑迁移（不改任何东西，只汇报）
nwd-admin migrate -dry-run

# 4. 真正迁移
nwd-admin migrate

# 输出类似：
#   schema state: legacy
#   migrated 12 plugin row(s): created 12 version(s), skipped 0 already-present version(s), dropped 4 legacy column(s)

# 5. 启动新版本
nwd-admin serve
```

迁移是**幂等**的：重复跑不会再创建重复行；中途失败后重跑会从断点继续。

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

rate_limit:
  read:  { rate: 60.0, burst: 30 }
  write: { rate: 5.0,  burst: 5  }
  admin: { rate: 30.0, burst: 10 }

audit:
  disable: false
  retention_days: 90
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
| `rate_limit.read.rate` | `RATE_LIMIT_READ_RATE` | `120` |
| `rate_limit.read.burst` | `RATE_LIMIT_READ_BURST` | `60` |
| `rate_limit.write.rate` | `RATE_LIMIT_WRITE_RATE` | `10` |
| `rate_limit.write.burst` | `RATE_LIMIT_WRITE_BURST` | `10` |
| `rate_limit.admin.rate` | `RATE_LIMIT_ADMIN_RATE` | `60` |
| `rate_limit.admin.burst` | `RATE_LIMIT_ADMIN_BURST` | `20` |
| `audit.disable` | `AUDIT_DISABLE` | `true` |
| `audit.retention_days` | `AUDIT_RETENTION_DAYS` | `30` |
| `server.tls.enabled` | `SERVER_TLS_ENABLED` | `true` |
| `server.tls.cert_file` | `SERVER_TLS_CERT_FILE` | `./tls/cert.pem` |
| `server.tls.key_file` | `SERVER_TLS_KEY_FILE` | `./tls/key.pem` |
| `server.tls.min_version` | `SERVER_TLS_MIN_VERSION` | `1.3` |
| `server.tls.redirect_http` | `SERVER_TLS_REDIRECT_HTTP` | `true` |

PowerShell 示例：

```powershell
$env:SERVER_ADDR = ':9000'
$env:DATABASE_DATA_DIR = 'D:\data\nwd-admin'
go run .
```

## 页面与 API

| 方法 | 路径 | 作用 | 鉴权 | 限流档 |
|---|---|---|:--:|:--:|
| `GET` | `/` | 公开落地页与服务统计 | — | read |
| `GET` | `/plugins` | 插件管理页面（带搜索/标签/分页） | — | read |
| `GET` | `/audit` | 审计日志页面 | admin | admin |
| `GET` | `/api/plugins` | 获取插件元数据列表（分页/搜索/标签） | — | read |
| `GET` | `/api/plugins/{id}/download` | 下载 latest 版本并累计下载次数 | — | read |
| `GET` | `/api/plugins/{id}/download?version=X` | 下载指定版本 | — | read |
| `GET` | `/api/plugins/{id}/versions` | 列出该插件的所有版本 | — | read |
| `POST` | `/api/plugins` | 上传并发布 `.nwd` 文件（同 ID 新版本会保留历史） | admin | write |
| `DELETE` | `/api/plugins/{id}?version=X` | 删除单个版本（latest 自动升级到上一个） | admin | write |
| `DELETE` | `/api/plugins/{id}?all=true` | 删除整个插件（所有版本） | admin | write |
| `GET` | `/api/audit-logs` | 分页查询审计日志（JSON） | admin | admin |

写接口未配置 admin 凭证时按"trusted-local"模式放行；配置后强制 Basic Auth。 限流超出时返回 `429 Too Many Requests` 并附带 `Retry-After` 头。

`/api/plugins` 接受以下查询参数（页面和 API 通用）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `q` | 空 | 关键字，匹配 id / name / author / description（大小写不敏感） |
| `tag` | 空 | 精确匹配 manifest.tags 中的一个标签 |
| `page` | 1 | 1-based 页码 |
| `size` | 20 | 每页条数，上限 200 |

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

### 查询审计日志

需要 admin 凭证。`page` 是 1-based 页码，`size` 默认 50，上限 500。

```bash
curl -u admin:mypassword 'http://localhost:8090/api/audit-logs?page=1&size=50'
```

返回结构：

```json
{
  "entries": [
    {
      "id": 42,
      "created_at": "2026-08-11T08:00:00+08:00",
      "actor": "admin",
      "actor_ip": "127.0.0.1",
      "action": "delete_plugin",
      "target": "hello-world",
      "http_method": "DELETE",
      "http_path": "/api/plugins/hello-world",
      "http_status": 200,
      "user_agent": "curl/8.4.0",
      "duration_ms": 12,
      "message": ""
    }
  ],
  "page": 1,
  "size": 50,
  "total": 1,
  "pageCount": 1
}
```

`action` 取值：

| 值 | 触发场景 |
|---|---|
| `upload_plugin` | `POST /api/plugins` 通过认证 |
| `delete_plugin` | `DELETE /api/plugins/{id}` 通过认证 |
| `list_audit_logs` | 任意成功的 `GET /api/audit-logs` |
| `auth_failure` | Basic Auth 失败（401） |
| `rate_limited` | 任意限流档拒绝（429） |
| `unknown_write` | 其他未识别的写方法（PUT/PATCH 等） |

匿名行（`actor = "anonymous"`）通常是扫描器、爬虫或被误用的脚本的痕迹。日志表默认保留 90 天，1 小时一次的 pruner 自动清理；通过 `audit.retention_days` 配置。

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
    "permissions": [],
    "tags": ["greeting", "demo"]
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
- `tags` 必须是字符串数组（可省略），用作可搜索的标签
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

- 写接口已加入 Basic Auth 和限流，但**没有 CSRF 防护**；浏览器直访需自行处理 CSRF
- 审计日志的查询接口只支持时间倒序分页，没有按操作者/动作/状态筛选
- 插件包存入 SQLite，不适合大规模下载或 CDN 分发
- 下载计数会受到爬虫、重试和预取影响
- 限流粒度只到 IP；同 NAT 后多用户会互相干扰
- 标签是简单 JSON 数组，无层级或别名
- ACME 模式只支持 http-01 challenge；需要 DNS 指向且 :80 可达

公网部署前仍需加入 CSRF 防护、审计查询筛选、按用户限流。

## 相关文档

- [`TECH_STACK.md`](./TECH_STACK.md)：架构、模块边界和技术决策
- [`../docs/plugin-architecture.md`](../docs/plugin-architecture.md)：客户端插件体系与 `.nwd` 规范
- [`../docs/troubleshooting.md`](../docs/troubleshooting.md)：客户端故障排查
