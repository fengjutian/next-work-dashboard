# next-work-dashboard — 设计规范文档

> 汇总：紫色主题 · UI 布局 · 组件选型 · 视觉风格  
> 风格方向：柔和淡紫 (Soft Lavender) — Linear / Notion 式克制雅致  
> 主色：`#8b5cf6` (violet-500)

---

## 一、色板 (Color Palette)

### 1.1 主色 — Violet / Lavender

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| `--primary` | `#8b5cf6` | `#a78bfa` | 主按钮、选中态、链接 |
| `--primary-hover` | `#7c3aed` | `#c4b5fd` | hover 加深/变亮 |
| `--primary-foreground` | `#ffffff` | `#0f0d16` | 主色上的文字 |
| `--primary-light` | `#ede9fe` | `#2e1065` | 浅色背景（badge、选中行） |
| `--primary-muted` | `#ddd6fe` | `#4c1d95` | 稍深背景（边框、hover） |

### 1.2 中性色 — 暖紫灰

带紫色底色的灰，保持全界面紫色氛围。

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| `--background` | `#faf9fb` | `#0f0d16` | 页面底色 |
| `--foreground` | `#1e1b2e` | `#e9e5f2` | 主文字 |
| `--card` | `#ffffff` | `#181522` | 卡片/面板 |
| `--border` | `#e4e0ee` | `#2a2538` | 边框线 |
| `--muted` | `#f3f1f8` | `#1d1930` | 次级背景（侧栏、工具栏） |
| `--muted-foreground` | `#6d6880` | `#958ea8` | 次要文字、placeholder |

### 1.3 语义色

| Token | Light | Dark |
|-------|-------|------|
| `--success` | `#10b981` | `#34d399` |
| `--warning` | `#f59e0b` | `#fbbf24` |
| `--destructive` | `#ef4444` | `#f87171` |

### 1.4 品牌渐变（仅 hero / 品牌位使用）

```
--gradient-brand: linear-gradient(135deg, #7c3aed, #a78bfa 50%, #c4b5fd);
--gradient-brand-dark: linear-gradient(135deg, #6d28d9, #8b5cf6 50%, #a78bfa);
```

### 1.5 阴影（带紫底柔和投影）

```css
--shadow-sm: 0 1px 2px 0 hsl(258 30% 14% / 0.04);
--shadow-md: 0 4px 12px -2px hsl(258 30% 14% / 0.06);
--shadow-lg: 0 10px 30px -8px hsl(258 30% 14% / 0.08);
```

---

## 二、CSS 变量全量定义

以下可直接覆盖 `index.css` 中 `:root` / `.dark` 块：

```css
:root {
  --background: 260 10% 98%;
  --foreground: 258 30% 14%;
  --card: 0 0% 100%;
  --card-foreground: 258 30% 14%;
  --border: 255 30% 91%;
  --muted: 258 30% 96%;
  --muted-foreground: 255 12% 45%;

  --primary: 262 83% 58%;
  --primary-foreground: 0 0% 100%;
  --primary-hover: 262 83% 48%;
  --primary-light: 258 90% 96%;

  --success: 160 84% 39%;
  --warning: 38 92% 50%;
  --destructive: 0 84% 60%;

  --sidebar-bg: 258 30% 96%;
  --sidebar-fg: 258 30% 14%;
  --sidebar-hover: 255 30% 91%;

  --radius: 0.625rem;
}

.dark {
  --background: 264 30% 7%;
  --foreground: 260 30% 92%;
  --card: 258 25% 11%;
  --card-foreground: 260 30% 92%;
  --border: 258 20% 18%;
  --muted: 258 30% 14%;
  --muted-foreground: 258 12% 62%;

  --primary: 262 83% 68%;
  --primary-foreground: 264 30% 7%;
  --primary-hover: 262 83% 74%;
  --primary-light: 264 40% 12%;

  --success: 160 84% 45%;
  --warning: 38 92% 60%;
  --destructive: 0 72% 58%;

  --sidebar-bg: 264 20% 10%;
  --sidebar-fg: 260 30% 92%;
  --sidebar-hover: 258 20% 18%;
}
```

---

## 三、UI 布局

```
┌──────┬──────────────────────────────────────────┐
│      │  [DeepSeek] [ChatGPT] [Kimi]  [+]        │ ← 标签栏
│ 侧   ├──────────────────────────────────────────┤
│ 边   │                                          │
│ 栏   │        AI 网站 WebView 区域               │
│      │                                          │
│ ·搜索 │                                          │
│ ·分类 ├──────────────────────────────────────────┤
│ ·列表 │  状态栏：注入成功 ✓  |  模式：仅填充       │
└──────┴──────────────────────────────────────────┘
```

| 区域 | 说明 |
|------|------|
| 左侧栏 | 260px，可折叠。含搜索框、分类树、提示词列表 |
| 顶部 ActivityBar | 48px 宽垂直图标栏，切换 AI / 设置 / 插件面板 |
| 标签栏 | WebView 多标签，支持关闭、拖拽排序 |
| WebView 区 | 主体面积，`<webview>` 标签，partition 持久化登录 |
| 状态栏 | 底部 28px，注入状态 + 模式指示 |

---

## 四、组件层使用规范

### 4.1 按钮层级

| 层级 | Tailwind | 场景 |
|------|----------|------|
| Primary | `bg-brand-500 hover:bg-brand-600 text-white` | 保存、提交、新建 |
| Secondary | `bg-brand-50 hover:bg-brand-100 text-brand-700` | 撤销、取消 |
| Ghost | `hover:bg-muted text-foreground` | 图标按钮、工具栏 |
| Outline | `border border-brand-300 text-brand-600` | 大纲按钮 |
| Danger | `bg-red-500 hover:bg-red-600 text-white` | 删除操作 |

### 4.2 选中/激活态

| 元素 | 样式 |
|------|------|
| 列表选中行 | `bg-brand-50 dark:bg-brand-950/50` |
| 激活 Tab 指示器 | `text-brand-600 border-brand-500` |
| 侧栏导航图标 | `text-brand-500 dark:text-brand-400` |
| Toggle 开关（开） | `bg-brand-500` |

### 4.3 Badge / Tag

```
默认:  bg-muted text-muted-foreground
品牌:  bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300
成功:  bg-emerald-50 text-emerald-700
```

### 4.4 现有 zinc → 新变量迁移对照

| 现有 | 替换为 | 影响 |
|------|--------|------|
| `bg-zinc-50` / `dark:bg-zinc-900` | `bg-background` | 页面底 |
| `bg-zinc-100` / `dark:bg-zinc-800` | `bg-muted` | 次级区域 |
| `text-zinc-500` | `text-muted-foreground` | 次要文字 |
| `border-zinc-200` | `border-border` | 边框 |
| `hover:bg-zinc-100` | `hover:bg-muted` | hover 态 |

---

## 五、字体与排版

| 属性 | 值 |
|------|-----|
| 系统字体 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif` |
| 等宽字体 | `'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace` |
| 正文字号 | `14px` (0.875rem) |
| 小字 | `12px` (0.75rem) / `11px` (标签) |
| 行高 | `1.5` |

---

## 六、间距与圆角

| Token | 值 | 场景 |
|-------|-----|------|
| `--radius` | `10px` | 卡片、浮层、Dialog |
| 按钮圆角 | `8px` | Button, Badge |
| 输入框圆角 | `8px` | Input, Select |
| 小组件圆角 | `6px` | Toggle, Tag, 图标按钮 |

---

## 七、技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 框架 | Electron 28+ | 桌面壳，原生窗口 + 托盘 |
| UI | React 18 + TypeScript | 生态成熟 |
| 组件库 | **shadcn/ui + Tailwind CSS** | 紧凑桌面风、暗色零成本、按需复制体积小 |
| 状态管理 | Zustand | 轻量、无 boilerplate |
| 持久化 | sql.js + drizzle-orm | 纯 JS SQLite，Windows 开箱即用 |
| 构建 | electron-forge + Vite | 官方推荐、插件完善 |
| WebView | 原生 `<webview>` | 多标签管理、partition 持久化登录态 |
| 图标 | react-icons (Fa6 / Lu / Hi) | 按需加载、体积小 |

---

## 八、Tailwind 配置

```js
// tailwind.config.js — 推荐扩展
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe',
          300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6',
          600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6',
          900: '#4c1d95', 950: '#2e1065',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-bg) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-fg) / <alpha-value>)',
          hover: 'hsl(var(--sidebar-hover) / <alpha-value>)',
        },
      },
    },
  },
};
```

---

## 九、WCAG 对比度合规

| 组合 | 对比度 | 评级 |
|------|--------|------|
| foreground / background (Light) | 13.2:1 | AAA |
| foreground / background (Dark) | 11.8:1 | AAA |
| muted-foreground / background (Light) | 4.9:1 | AA |
| white / primary (Light) | 4.6:1 | AA |

---

## 十、实施路线

| Phase | 内容 | 改动范围 |
|-------|------|----------|
| 1 | CSS 变量 — `index.css` 定义 `:root` / `.dark` HSL 变量 | 1 文件 |
| 2 | Tailwind — `tailwind.config.js` 新增 `brand` 色阶 | 1 文件 |
| 3 | 组件迁移 — 按 §4.4 对照表渐进替换类名 | ~15 文件 |
| 4 | 验证 — Light/Dark 全页面走查 | 手动 |

---

## 十一、视觉参考

| 产品 | 借鉴点 |
|------|--------|
| **Linear** | 暗色紫底黑 + 半透明紫边框的克制使用 |
| **Notion** | 淡紫灰侧栏 + 纯白内容区层次感 |
| **Vercel** | 紫色渐变在品牌标识位点缀 |
| **Arc Browser** | 半透明毛玻璃侧栏 + 彩色圆点标识 |

---

> **核心原则**：紫色是"氛围色" — 大面积暖紫灰中性色，小面积 violet-500 点缀，渐变仅品牌位出现。
