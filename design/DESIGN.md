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

### 1.6 传统紫色参考色谱

以下颜色取自参考色卡，作为插图、数据可视化、标签和主题扩展的备选色。界面基础语义色仍使用 1.1～1.3 中定义的 token。

| 色名 | Hex | 色名 | Hex | 色名 | Hex | 色名 | Hex |
|------|-----|------|-----|------|-----|------|-----|
| 退红 | `#f0cfe3` | 樱花 | `#e4b8d5` | 丁香 | `#ce93bf` | 木槿 | `#ba79b1` |
| 紫蒲 | `#a6559d` | 赪紫 | `#8a1874` | 齐紫 | `#6c216d` | 香炉紫烟 | `#d3ccd6` |
| 昌荣 | `#dcc7e1` | 紫薄汗 | `#bba1cb` | 茈藐 | `#a67eb7` | 紫紶 | `#7d5284` |
| 拂紫绵 | `#7e527f` | 三公子 | `#663d74` | 凝夜紫 | `#422256` | 紫菂 | `#9b8ea9` |
| 暮山紫 | `#a4abd6` | 紫苑 | `#757cbb` | 优昙瑞 | `#615ea8` | 延维 | `#4a4b9d` |
| 紫府 | `#995d7f` | 芥拾紫 | `#602641` | 油紫 | `#420b2f` | 鸦雏 | `#6a5b6d` |

```css
:root {
  --purple-tuihong: #f0cfe3;
  --purple-yinghua: #e4b8d5;
  --purple-dingxiang: #ce93bf;
  --purple-mujin: #ba79b1;
  --purple-zipu: #a6559d;
  --purple-chengzi: #8a1874;
  --purple-qizi: #6c216d;
  --purple-xianglu-ziyan: #d3ccd6;
  --purple-changrong: #dcc7e1;
  --purple-zibohan: #bba1cb;
  --purple-zimiao: #a67eb7;
  --purple-zichou: #7d5284;
  --purple-fuzimian: #7e527f;
  --purple-sangongzi: #663d74;
  --purple-ningyezi: #422256;
  --purple-zidi: #9b8ea9;
  --purple-mushanzi: #a4abd6;
  --purple-ziyuan: #757cbb;
  --purple-youtanrui: #615ea8;
  --purple-yanwei: #4a4b9d;
  --purple-zifu: #995d7f;
  --purple-jieshizi: #602641;
  --purple-youzi: #420b2f;
  --purple-yachu: #6a5b6d;
}
```

### 1.7 传统紫色使用规则

传统色是扩展色，不直接替代 `primary`、`destructive` 等语义 token。组件只能通过语义 token 使用颜色；插图、图表和品牌装饰可以直接引用传统色变量。

| 分组 | 推荐颜色 | 用途 | 限制 |
|------|----------|------|------|
| 浅色底纹 | 退红、樱花、昌荣、香炉紫烟 | 空状态插图、卡片底纹、品牌水印 | 不承载低于 16px 的白色文字 |
| 中度强调 | 丁香、木槿、紫蒲、茈藐、暮山紫 | 标签、图表、图标背景 | 文字颜色须单独进行对比度检查 |
| 深色强调 | 赪紫、齐紫、三公子、凝夜紫、油紫 | 深色描边、图表高亮、品牌装饰 | 不作为大面积页面背景 |
| 冷紫序列 | 暮山紫、紫苑、优昙瑞、延维 | 图谱节点、数据系列 | 相邻色同时出现时增加形状或线型区分 |
| 暖紫序列 | 退红、樱花、木槿、紫蒲、紫府、芥拾紫 | 分类图、进度分段 | 不表达成功、警告或错误语义 |

数据可视化默认顺序：

```css
--chart-1: #757cbb; /* 紫苑 */
--chart-2: #a6559d; /* 紫蒲 */
--chart-3: #615ea8; /* 优昙瑞 */
--chart-4: #995d7f; /* 紫府 */
--chart-5: #a67eb7; /* 茈藐 */
--chart-6: #663d74; /* 三公子 */
```

---

## 二、CSS 变量全量定义

### 2.1 Token 契约

- CSS 变量采用 `H S% L%` 三元值，以支持 Tailwind 的透明度语法。
- Hex 仅用于设计稿、色卡和验收对照，不作为组件内硬编码值。
- 组件必须使用语义 token；禁止新增 `blue-*`、`zinc-*` 或硬编码 OKLCH。
- `foreground` 后缀表示该背景上的默认文字/图标颜色。
- 新组件若需要新颜色，应先判断能否映射到现有语义，再新增 token。

### 2.2 完整变量

以下可直接覆盖 `index.css` 中 `:root` / `.dark` 块：

```css
:root {
  --background: 260 10% 98%;
  --foreground: 258 30% 14%;

  --card: 0 0% 100%;
  --card-foreground: 258 30% 14%;
  --popover: 0 0% 100%;
  --popover-foreground: 258 30% 14%;

  --border: 255 30% 91%;
  --input: 255 24% 87%;
  --ring: 262 83% 58%;

  --muted: 258 30% 96%;
  --muted-foreground: 255 12% 45%;
  --accent: 258 90% 96%;
  --accent-foreground: 262 65% 38%;
  --secondary: 258 30% 96%;
  --secondary-foreground: 258 30% 20%;

  --primary: 262 83% 58%;
  --primary-foreground: 0 0% 100%;
  --primary-hover: 262 83% 48%;
  --primary-light: 258 90% 96%;
  --primary-muted: 255 91% 93%;

  --success: 160 84% 39%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 32 95% 14%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --info: 217 91% 60%;
  --info-foreground: 0 0% 100%;

  --sidebar-bg: 258 30% 96%;
  --sidebar-fg: 258 30% 14%;
  --sidebar-hover: 255 30% 91%;
  --sidebar-active: 258 90% 96%;
  --sidebar-active-foreground: 262 65% 38%;
  --sidebar-border: 255 30% 91%;

  --overlay: 258 30% 8% / 0.42;
  --disabled-opacity: 0.5;

  --radius: 0.625rem;
}

.dark {
  --background: 264 30% 7%;
  --foreground: 260 30% 92%;

  --card: 258 25% 11%;
  --card-foreground: 260 30% 92%;
  --popover: 258 25% 11%;
  --popover-foreground: 260 30% 92%;

  --border: 258 20% 18%;
  --input: 258 18% 24%;
  --ring: 262 83% 68%;

  --muted: 258 30% 14%;
  --muted-foreground: 258 12% 62%;
  --accent: 264 40% 12%;
  --accent-foreground: 258 90% 84%;
  --secondary: 258 30% 14%;
  --secondary-foreground: 260 30% 92%;

  --primary: 262 83% 68%;
  --primary-foreground: 264 30% 7%;
  --primary-hover: 262 83% 74%;
  --primary-light: 264 40% 12%;
  --primary-muted: 263 55% 28%;

  --success: 160 84% 45%;
  --success-foreground: 164 90% 8%;
  --warning: 38 92% 60%;
  --warning-foreground: 32 95% 12%;
  --destructive: 0 72% 58%;
  --destructive-foreground: 0 0% 100%;
  --info: 217 91% 68%;
  --info-foreground: 222 70% 10%;

  --sidebar-bg: 264 20% 10%;
  --sidebar-fg: 260 30% 92%;
  --sidebar-hover: 258 20% 18%;
  --sidebar-active: 264 40% 16%;
  --sidebar-active-foreground: 258 90% 84%;
  --sidebar-border: 258 20% 18%;

  --overlay: 264 40% 3% / 0.68;
  --disabled-opacity: 0.5;
}
```

### 2.3 状态优先级

同一组件同时出现多个状态时，视觉优先级为：

`disabled > invalid > loading > pressed > focus-visible > hover > default`

`focus-visible` 可以与 `invalid`、`selected` 同时显示；不得仅依赖颜色表达错误或选中状态。

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

### 4.5 通用交互状态

| 状态 | 规范 |
|------|------|
| Hover | 仅指针设备显示；背景或边框变化应可感知，但不引发布局位移 |
| Focus visible | `ring-2 ring-ring ring-offset-2 ring-offset-background` |
| Pressed | 在 hover 基础上降低约 6% 明度，可使用 `translate-y-px`，持续不超过 100ms |
| Selected | 使用 `accent` 背景、`accent-foreground` 文字，并保留图标或勾选标记 |
| Disabled | `opacity-[var(--disabled-opacity)] pointer-events-none`，不显示 hover |
| Loading | 保留组件原尺寸；显示进度图标并通过 `aria-busy` 暴露状态 |
| Invalid | `border-destructive` 与错误文本同时出现；聚焦环使用 destructive |
| Read only | 保留正常对比度，隐藏编辑 affordance，不使用 disabled 样式 |
| Dragging | 元素使用 `shadow-lg`、80% 不透明度；目标位置显示 2px primary 指示线 |

### 4.6 组件主题矩阵

| 组件 | Default | Hover / Active | Focus / Invalid | Disabled |
|------|---------|----------------|-----------------|----------|
| Button Primary | `bg-primary text-primary-foreground` | `bg-primary-hover` | 通用 focus ring | 通用 disabled |
| Button Secondary | `bg-secondary text-secondary-foreground` | `bg-accent` | 通用 focus ring | 通用 disabled |
| Button Outline | `border-input bg-background` | `bg-accent text-accent-foreground` | 通用 focus ring | 通用 disabled |
| Input / Textarea | `border-input bg-background` | `border-primary/50` | `ring-ring` / `border-destructive` | disabled 或 read-only 规则 |
| Select / Combobox | 与 Input 一致 | 选项 `bg-accent` | 通用 focus ring | 通用 disabled |
| Checkbox / Radio | `border-input bg-background` | `border-primary` | 通用 focus ring | 通用 disabled |
| Switch | `bg-input` | `bg-input/80` | 通用 focus ring | 通用 disabled |
| Switch Checked | `bg-primary` | `bg-primary-hover` | 通用 focus ring | 通用 disabled |
| Tabs | `text-muted-foreground` | `bg-accent/60` | Tab 本身显示 focus ring | 通用 disabled |
| Tab Active | `bg-card text-foreground shadow-sm` | 保持激活态 | focus 与激活态共存 | — |
| Tree / List row | `text-foreground` | `bg-accent/60` | 行或内部控件显示 focus | `text-muted-foreground` |
| Dialog / Popover | `bg-popover text-popover-foreground border-border shadow-lg` | — | 首个可操作项获得焦点 | — |
| Tooltip | `bg-foreground text-background` | — | 不接收焦点 | — |
| Toast | `bg-card border-border shadow-lg` | 暂停自动关闭 | 操作按钮可聚焦 | — |
| Table | `bg-card border-border` | 行 `bg-muted/60` | 单元格控件可聚焦 | `text-muted-foreground` |

### 4.7 反馈组件

| 类型 | 图标/强调色 | 背景建议 | 必需内容 |
|------|-------------|----------|----------|
| Success | `success` | `success/10` | 成功图标 + 简短结果 |
| Warning | `warning` | `warning/12` | 警告图标 + 影响说明 |
| Error | `destructive` | `destructive/10` | 错误图标 + 原因或恢复动作 |
| Info | `info` | `info/10` | 信息图标 + 补充说明 |

Toast 默认显示 4 秒；包含关键错误或用户操作时不自动关闭。颜色不得作为唯一的反馈信号。

### 4.8 页面状态

| 状态 | 设计要求 |
|------|----------|
| Loading | 首次加载使用骨架屏；局部操作使用行内 spinner，避免整页遮挡 |
| Empty | 图标或轻量插图 + 原因说明 + 最多一个主要行动 |
| Error | 明确失败对象、可能原因和重试入口；保留用户已输入内容 |
| Offline | 状态栏持续提示，依赖网络的操作就地禁用并说明原因 |
| Permission denied | 说明所需权限及开启路径，不循环弹窗 |
| WebView crashed | 显示重新加载、复制地址和关闭标签页三个动作 |

---

## 五、字体与排版

| 属性 | 值 |
|------|-----|
| 系统字体 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif` |
| 等宽字体 | `'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace` |
| 页面标题 | `20px / 28px`, 600 |
| 面板标题 | `16px / 24px`, 600 |
| 正文 | `14px / 21px`, 400 |
| Label / Button | `13px / 18px`, 500 |
| 辅助文字 | `12px / 18px`, 400 |
| 紧凑标签 | `11px / 16px`, 500；不用于长段落 |
| 代码与数字 | `13px / 20px`，使用等宽字体 |

- 中文与英文之间由排版引擎自然处理，不手工插入空格；数字与单位之间不加空格，如 `16px`。
- 标题最多两行，工具栏与列表标题默认单行省略；完整内容通过 Tooltip 或详情区域提供。
- 正文禁止使用低于 12px 的字号；11px 仅用于空间受限的状态标签。
- 表格数字右对齐，正文左对齐；时间、ID、快捷键使用等宽字体。

---

## 六、间距与圆角

### 6.1 间距与尺寸

基础单位为 `2px`，优先使用以下序列：

| Token | 值 | 常见用途 |
|-------|-----|----------|
| `space-0.5` | `2px` | 图标内部微调 |
| `space-1` | `4px` | 紧密元素间距 |
| `space-1.5` | `6px` | 图标与文字 |
| `space-2` | `8px` | 控件内部间距 |
| `space-3` | `12px` | 列表行、紧凑面板 |
| `space-4` | `16px` | 默认面板内边距 |
| `space-6` | `24px` | 区块间距 |
| `space-8` | `32px` | 页面级分组 |

| 控件 | 紧凑 | 默认 |
|------|------|------|
| Button / Input | `28px` | `32px` |
| 图标按钮 | `28 × 28px` | `32 × 32px` |
| 列表行 | `28px` | `36px` |
| 顶部标签栏 | `32px` | `36px` |
| 状态栏 | `28px` | `28px` |

图标视觉尺寸使用 `14 / 16 / 20px`；可点击区域不得小于 `28 × 28px`。

### 6.2 圆角

| Token | 值 | 场景 |
|-------|-----|------|
| `--radius` | `10px` | 卡片、浮层、Dialog |
| 按钮圆角 | `8px` | Button, Badge |
| 输入框圆角 | `8px` | Input, Select |
| 小组件圆角 | `6px` | Toggle, Tag, 图标按钮 |

### 6.3 层级与遮罩

| 层级 | z-index | 场景 |
|------|---------|------|
| Base | `0` | 页面、面板 |
| Sticky | `10` | 吸顶工具栏、状态栏 |
| Dropdown | `30` | Select、Dropdown、Popover |
| Overlay | `40` | Dialog 遮罩 |
| Modal | `50` | Dialog、命令面板 |
| Toast | `60` | 全局通知 |
| Tooltip | `70` | Tooltip |

禁止在组件内随意使用超过 `70` 的层级。模态遮罩使用 `--overlay`；毛玻璃仅用于浮层和侧栏，正文区域不得使用。

### 6.4 动效

| 场景 | 时长 | 缓动 |
|------|------|------|
| Hover / Pressed | `100–120ms` | `ease-out` |
| 普通状态切换 | `140–160ms` | `ease-out` |
| Popover / Tooltip | `120–160ms` | `ease-out` |
| 面板 / Dialog | `180–240ms` | `cubic-bezier(0.16, 1, 0.3, 1)` |

- 优先动画 `opacity` 与 `transform`，避免对宽高和位置进行大范围动画。
- 加载动画应稳定循环，不使用闪烁。
- `prefers-reduced-motion: reduce` 时移除位移和缩放，只保留必要的即时透明度变化。

### 6.5 图标系统

#### 图标库优先级

| 优先级 | 来源 | 使用范围 |
|--------|------|----------|
| 1 | `lucide-react` | 应用外壳、按钮、导航、表单和通用操作图标 |
| 2 | `react-icons/fa6` | AI 站点、文件类型和第三方品牌 Logo |
| 3 | `react-icons` 其他集合 | 仅用于 Lucide 无对应图标的存量功能，新增前需确认必要性 |
| 限定 | `@ant-design/icons` | 仅允许在依赖 Ant Design 的插件内部使用 |
| 自定义 SVG | 项目图标组件 | 产品 Logo、插件 Logo 和无法由现有库表达的专用图标 |

同一工具栏或同一组操作不得混用不同风格的通用图标。现有图标通过 `components/icons.tsx` 统一导出，迁移期间业务组件不直接增加新的图标库入口。

#### 尺寸与线宽

| Token | 尺寸 | 场景 |
|-------|------|------|
| `icon-xs` | `12px` | 紧凑状态标签、内联提示 |
| `icon-sm` | `14px` | 小按钮、表格、列表辅助操作 |
| `icon-md` | `16px` | 默认按钮、输入框、工具栏 |
| `icon-lg` | `20px` | ActivityBar、空状态辅助图标 |
| `icon-xl` | `24px` | 页面级功能入口 |
| `icon-display` | `40–64px` | 空状态插图，不作为操作按钮 |

- Lucide 默认线宽为 `1.75`；激活态可使用 `2`，不得通过粗线宽表达 disabled。
- 品牌 Logo 保持原始比例，不强制使用 Lucide 线宽。
- 图标与文字间距默认 `6px`，紧凑控件可使用 `4px`。
- 图标使用偶数像素尺寸并在像素网格上居中，禁止用不一致的负 margin 修正。

#### 颜色与状态

| 状态 | 颜色 |
|------|------|
| 默认操作 | `text-muted-foreground` |
| Hover | `text-foreground` |
| 激活 / 选中 | `text-primary` |
| Disabled | 继承 disabled opacity |
| Success | `text-success` |
| Warning | `text-warning` |
| Error / Destructive | `text-destructive` |
| Info | `text-info` |

图标必须使用 `currentColor` 并继承语义文本色，禁止在 SVG 内硬编码主题颜色。品牌 Logo 和数据可视化图标除外。

#### 图标按钮

- 紧凑和默认点击区域分别为 `28 × 28px`、`32 × 32px`，图标本身通常为 `14px` 或 `16px`。
- 只有图标的按钮必须提供 `aria-label`；桌面端同时提供 Tooltip。
- Tooltip 使用动宾结构，如“关闭标签页”“重新加载”，不只写“关闭”“刷新”。
- 危险操作不得只通过红色垃圾桶表达；需要确认或提供清晰的上下文。
- Toggle 类图标按钮必须暴露 `aria-pressed`，并同时使用背景或指示条表达选中状态。

#### 状态与含义

| 含义 | 推荐图标 |
|------|----------|
| 成功 | `CircleCheck` |
| 警告 | `TriangleAlert` |
| 错误 | `CircleX` |
| 信息 | `Info` |
| 加载 | `LoaderCircle`，仅此类图标允许持续旋转 |
| 搜索 | `Search` |
| 设置 | `Settings` |
| 新建 | `Plus` |
| 更多 | `Ellipsis` |
| 关闭 | `X` |

相同图标在全应用中保持相同含义；同一含义不得在相邻界面使用多个不同图标。Emoji 不作为功能图标。

#### 自定义 SVG

- 使用 `viewBox="0 0 24 24"`，默认 `fill="none"`、`stroke="currentColor"`。
- 必须移除编辑器元数据、固定宽高和硬编码颜色。
- 装饰图标设置 `aria-hidden="true"`；独立传达信息的图标提供可访问名称。
- 插件必须提供 `16px` 与 `20px` 下仍可辨识的单色图标；缺失时使用统一的 `Puzzle` 占位图标。

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
| 图标 | **lucide-react 为主，react-icons/fa6 用于品牌** | 通用图标风格统一，品牌图标保真；通过统一出口渐进迁移 |

---

## 八、Tailwind 配置

```js
// tailwind.config.js — 推荐扩展
module.exports = {
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          hover: 'hsl(var(--primary-hover) / <alpha-value>)',
          light: 'hsl(var(--primary-light) / <alpha-value>)',
          muted: 'hsl(var(--primary-muted) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
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
          active: 'hsl(var(--sidebar-active) / <alpha-value>)',
          'active-foreground': 'hsl(var(--sidebar-active-foreground) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
};
```

---

## 九、WCAG 对比度合规

### 9.1 验收阈值

| 对象 | 最低要求 |
|------|----------|
| 小于 18px 的普通文字 | `4.5:1` |
| 大于等于 18px 粗体或 24px 普通文字 | `3:1` |
| 图标、边框、焦点环等非文字 UI | `3:1` |
| Disabled 与纯装饰元素 | 不要求，但仍需可辨识 |

### 9.2 已定义关键组合

| 组合 | 目标评级 |
|------|----------|
| foreground / background，Light 与 Dark | AAA |
| card-foreground / card，Light 与 Dark | AAA |
| muted-foreground / background，Light 与 Dark | AA |
| primary-foreground / primary，Light 与 Dark | AA |
| destructive-foreground / destructive | AA |
| focus ring / 相邻背景 | 非文字 UI `3:1` |

每次调整 token 后必须重新计算实际对比度，不以本表目标代替测试。传统色直接承载文字时必须逐项验证。

### 9.3 键盘与辅助技术

- 所有操作必须可通过键盘完成，焦点顺序与视觉顺序一致。
- 图标按钮必须提供可访问名称；Tooltip 不能替代 `aria-label`。
- 错误、成功和选中状态必须同时提供文字、图标或形状提示。
- Dialog 打开后锁定焦点，关闭后把焦点返回触发元素。
- 动态 Toast 使用合适的 live region；非紧急消息不得打断屏幕阅读器。

---

## 十、实施路线

| Phase | 内容 | 改动范围 |
|-------|------|----------|
| 1 | Token 基线 — 在 `index.css` 落地 §2 的完整变量 | 1 文件 |
| 2 | Tailwind 映射 — 落地 §8 的语义色与圆角配置 | 1 文件 |
| 3 | 基础组件 — Button、Input、Select、Dialog、Toast 改用语义 token | `components/ui` |
| 4 | 应用外壳 — ActivityBar、标签栏、侧栏、状态栏迁移 | 核心布局组件 |
| 5 | 功能面板 — 按模块移除 `zinc-*`、`blue-*` 和硬编码 OKLCH | 全部面板与插件 |
| 6 | 专用画布 — WebView、Terminal、Graph、Excel、PPT 主题适配 | 专项组件 |
| 7 | 验证 — Light / Dark / System、键盘、缩放与视觉回归 | 自动化 + 手动 |

### 10.1 完成定义

- 新增组件不含无审批的硬编码颜色。
- Light、Dark、System 三种模式均可实时切换，无需刷新。
- 系统主题变化时，`system` 模式即时同步。
- 100%、125%、150% 缩放下无文字裁切和关键操作遮挡。
- 空、加载、错误、禁用、长文本状态均有验收截图。
- `git grep` 不再发现业务组件中的 `zinc-*`、`blue-*` 或硬编码 OKLCH；第三方画布主题配置除外。

---

## 十一、桌面端与专用画布

| 区域 | 主题要求 |
|------|----------|
| 窗口标题栏 | 可拖拽区不得覆盖交互控件；双击、最小化、最大化和关闭行为保持系统习惯 |
| WebView | 加载、断网、证书错误、崩溃分别提供状态页；网页内容主题不强制跟随应用 |
| Terminal | 使用独立 ANSI 16 色板；背景和前景跟随应用主题，ANSI 颜色不得映射为品牌语义色 |
| Knowledge Graph | 节点颜色使用 §1.7 图表序列；选中节点同时增加描边和尺寸变化 |
| Excel / Table | 冻结区、选区、编辑单元格、错误单元格必须有不同视觉状态 |
| PPT / Preview | 画布外围使用 `muted`，页面本身保持白色或文档指定背景 |
| 插件 iframe | 通过 SDK 传递解析后的主题值和 token；禁止插件直接读取宿主 DOM 类名 |

系统主题同步规则：

1. 用户选择 `light` 或 `dark` 时，以用户设置为准。
2. 用户选择 `system` 时，监听 `prefers-color-scheme` 变化并即时更新。
3. 应用根节点、Portal、原生菜单和支持主题的专用画布必须在同一轮更新中同步。
4. 主题切换不得清空表单、重建 WebView 或重启终端进程。

---

## 十二、视觉参考

| 产品 | 借鉴点 |
|------|--------|
| **Linear** | 暗色紫底黑 + 半透明紫边框的克制使用 |
| **Notion** | 淡紫灰侧栏 + 纯白内容区层次感 |
| **Vercel** | 紫色渐变在品牌标识位点缀 |
| **Arc Browser** | 半透明毛玻璃侧栏 + 彩色圆点标识 |

---

> **核心原则**：紫色是"氛围色" — 大面积暖紫灰中性色，小面积 violet-500 点缀，渐变仅品牌位出现。
