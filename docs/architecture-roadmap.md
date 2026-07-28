# 架构演进路线图

> 源于对 Continue.dev 架构的分析，结合 next-work-dashboard 当前代码现状的改造优先级。

---

## 优先级总览

| 优先级 | 方向 | 改动规模 | 用户感知 | 状态 |
|--------|------|:--:|:--:|:--:|
| ⭐⭐⭐ | **1. Core/UI 分离** | 小 | 无（架构收益） | ✅ 已完成 |
| ⭐⭐⭐ | **4. Context Provider** | 中 | 🔥 高 | 📋 待实现 |
| ⭐⭐ | **2. Protocol 驱动** | 大 | 无（类型安全） | 📋 待实现 |
| ⭐⭐ | **3. LLM 抽象层** | 中 | 中（API 直连） | ✅ 骨架已建 |
| ⭐ | **5. 工具系统** | 小 | 低 | 📋 待实现 |

---

## 1. Core/UI 分离 ✅

### 目标
将注入逻辑和对话提取逻辑从 React 组件中抽离为纯函数，放到 `src/core/` 目录。

### 已完成
```
src/core/
├── injector.ts              # buildInjectionScript(), extractVariables(), fillVariables()
├── conversation-extractor.ts # buildConversationExtractScript()
├── llm.ts                   # LLMProvider 接口 + createOpenAIProvider()
└── index.ts                 # barrel export
```

### 效果
- `WebViewContainer.tsx` 减少 ~160 行内联脚本
- 注入逻辑可独立单测
- 为后续 LLM API 直连模式铺路

---

## 4. Context Provider（模板变量自动填充）

### 目标
提示词中的 `{{变量}}` 不再只能手动输入，支持自动上下文填充。

### 方案
```
src/core/context-providers/
├── types.ts           # ContextProvider 接口
└── builtin.ts         # 内置 provider：{{date}} {{time}} {{clipboard}} {{selection}} {{activeTabUrl}}
```

### ContextProvider 接口
```typescript
interface ContextProvider {
  name: string;                             // e.g. "date"
  description: string;
  resolve(): string | Promise<string>;      // 同步或异步取值
}
```

### 渲染层改动
1. `PromptVariable` 增加 `provider?: string` 字段
2. `injector.ts` 的 `buildInjectionScript()` 调用前先 `resolveVariables()` — 优先走 provider，fallback 到手动输入
3. `VariableFillDialog` 识别有 provider 的变量，自动填充并标记为只读

### 收益
- 用户写 `今天是 {{date}}，帮我 {{clipboard}}` 自动获取日期和剪贴板
- 模板变量从"占位符"升级为"动态上下文"

---

## 2. Protocol 驱动（IPC 类型化）

### 目标
将散落的 `ipcMain.handle` / `ipcRenderer.invoke` 集中为类型安全的协议层。

### 方案
```
src/protocol/
├── channels.ts    # IPC_CHANNELS 枚举 + 每个 channel 的 Request/Response 类型
└── index.ts       # 类型化的 invoke<T>(channel, args)
```

### 示例
```typescript
// 定义
const IPC = {
  'db:load':   { req: void,                          res: ArrayBuffer | null },
  'db:save':   { req: { data: ArrayBuffer },         res: { success: boolean } },
  'inject-prompt': { req: { siteId, promptId, ... }, res: { success: boolean; error?: string } },
} as const;

// 使用（编译期检查）
const result = await electronAPI.invoke('db:save', { data: buffer });
//      ^ typed as { success: boolean }
```

### 收益
- 编译期检查 channel 是否存在
- 参数和返回值有完整类型提示
- 新增 IPC 时不会拼错 channel 名称

---

## 3. LLM 抽象层 ✅（骨架）

### 目标
统一模型调用接口，支持 OpenAI 兼容 API、DeepSeek、本地 Ollama 等。

### 已完成
```
src/core/llm.ts
├── LLMProvider 接口       # chat(), listModels(), validate()
├── createOpenAIProvider() # OpenAI 兼容实现（流式 SSE 解析）
└── Provider Registry     # registerProvider() / getProvider() / listProviders()
```

### 待完成
- [ ] DeepSeek 专用 Provider（特殊参数、FIM 补全）
- [ ] Ollama Provider（本地模型）
- [ ] Anthropic Provider（Claude Messages API）
- [ ] Store 中 `aiApi` 替换为 `LLMProvider` 实例
- [ ] AI Panel 插件接入 LLMProvider

---

## 5. 工具系统（注入插件化）

### 目标
利用已有 `PluginRegistry` 体系，让特殊站点的注入逻辑可插件化。

### 方案
```typescript
// plugins/types.ts
interface PluginContributions {
  injectors?: Record<string, Injector>;  // siteId → 自定义注入器
}

interface Injector {
  buildScript(opts: InjectOptions): string;  // 替代通用 buildInjectionScript
}
```

### 使用场景
- Gemini 的 `contenteditable` div 需要特殊处理
- 微信、钉钉等非标准输入框
- 需要预先点击、滚动等交互的站点

### 改动
- `PluginRegistry` 增加 `resolveInjector(siteId) → Injector | undefined`
- `WebViewContainer.doInject()` 先查 registry，fallback 到通用 CSS selector 注入

---

## 实施建议

1. **立即**：Context Provider（用户体验质变，改动可控）
2. **短期**：LLM Provider 接入（利用已建骨架连接 DeepSeek API）
3. **中期**：Protocol 驱动（重构性质，配合新功能逐步迁移）
4. **观望**：工具系统（等特殊站点需求驱动）
