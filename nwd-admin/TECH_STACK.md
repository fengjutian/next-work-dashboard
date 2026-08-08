# nwd-admin — 技术选型

## 定位

next-work-dashboard 的插件管理后台。提供：
- 插件市场上架 / 版本管理
- 插件下载分发（供 Electron 客户端拉取）
- 管理后台 Dashboard（落地页 → 插件列表 → CRUD）

## 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 语言 | Go 1.22+ | 宿主要求；单二进制部署；高并发 |
| Web 框架 | **chi** | 轻量、idiomatic、兼容 net/http，无黑盒 |
| 模板引擎 | **Go html/template** | 标准库，零依赖，服务端渲染落地页 + 管理页 |
| 前端增强 | **HTMX + Alpine.js**（CDN） | 无构建步，SSR 为主，渐进增强交互 |
| CSS | **Tailwind CSS**（CDN） | 快速原型，与 Electron 端的 purple 主题对齐 |
| 数据库 | **SQLite**（GORM sqlite driver） | 零运维，与 Electron 端一致 |
| ORM | **GORM** | 企业级 ORM，AutoMigrate、链式查询、Hooks |
| 日志 | **log/slog**（结构化 JSON） | 标准库，stderr JSON 输出 |
| 配置 | 命令行 flag（近期切 Viper） | 简洁可扩展 |
| 部署 | 单二进制 `nwd-admin` | `CGO_ENABLED=0 go build` 即交付 |

## 模块拆分（首期 MVP）

```
nwd-admin/
├── main.go                 # 入口：flag 解析、DB 初始化、启动 HTTP
├── go.mod
├── go.sum
├── internal/
│   ├── db/
│   │   ├── sqlite.go       # 连接 + 迁移
│   │   └── schema.sql      # DDL
│   ├── model/
│   │   └── plugin.go       # Plugin 结构体 + CRUD
│   ├── handler/
│   │   ├── home.go         # 落地页（GET /）
│   │   ├── plugins.go      # 插件管理页面
│   │   └── api.go          # REST API（JSON，供客户端拉取）
│   └── view/
│       ├── layout.html     # 公共布局（nav、head）
│       ├── home.html       # 落地页模板
│       └── plugins.html    # 插件列表模板
└── static/                 # 静态资源（可选）
```

## 路由设计

| Method | Path | 说明 |
|--------|------|------|
| GET | `/` | 管理后台落地页 |
| GET | `/plugins` | 插件列表页 |
| GET | `/plugins/:id` | 插件详情页 |
| GET | `/api/plugins` | JSON API：已发布插件列表 |
| GET | `/api/plugins/:id/download` | 下载 .nwd 包 |
| POST | `/api/plugins` | 上传新插件（管理端） |
| PUT | `/api/plugins/:id` | 更新插件版本 |
| DELETE | `/api/plugins/:id` | 下架插件 |

## 数据库（SQLite）

```sql
CREATE TABLE plugins (
    id          TEXT PRIMARY KEY,          -- 'my-custom-plugin'
    name        TEXT NOT NULL,             -- '我的插件'
    version     TEXT NOT NULL,             -- '0.2.0'
    author      TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    icon_emoji  TEXT NOT NULL DEFAULT '📊',
    tags        TEXT NOT NULL DEFAULT '[]',-- JSON array
    bundle      BLOB NOT NULL,             -- .nwd 文件内容
    size        INTEGER NOT NULL DEFAULT 0,
    downloads   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_plugins_updated ON plugins(updated_at DESC);
```

## 落地页设计

- 顶部 Nav：Logo + 统计卡片（插件数、下载量）
- Hero 区域：标题 + 描述
- 最近插件列表（卡片式）
- Footer：版本信息
- 色调：与 Electron 端对齐 purple 主题（`#8b5cf6` / `#a78bfa`）

## 后续扩展

- 用户认证（admin 登录）
- 插件审批流（上架审核）
- 下载统计图表
- 灰度发布（版本通道：stable / beta）
- Webhook 通知 Electron 客户端更新
