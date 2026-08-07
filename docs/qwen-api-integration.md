# 千问 API 接入说明

应用的 AI API 设置现支持 DeepSeek、千问（DashScope）和自定义 OpenAI 兼容服务。

## 千问预设

- OpenAI 兼容 Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- API Key：通常以 `sk-ws-` 开头；Token Plan 使用对应的专属 Key。
- 默认模型：`qwen3.7-plus`
- 可选模型：`qwen3.8-max-preview`、`qwen3.7-plus`、`qwen3.7-flash`，以及千问平台托管的 `deepseek-v4-pro`、`deepseek-v4-flash`。

Token Plan 的 `sk-sp-` Key 使用专属地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，不能与按量付费地址混用。设置页会按 Key 前缀自动选择，也允许手动切换计费类型。

## 兼容性策略

- 继续复用现有 `createOpenAIProvider`、SSE 流式解析和 function calling，不复制对话实现。
- 每个供应商单独保留 API Key；切换回 DeepSeek 时恢复原有 Key、Base URL 和模型。
- 对话模型列表跟随供应商切换，避免把其他供应商的模型 ID 发往当前端点。
- 千问供应商表示使用千问平台端点和 Key，不限制模型品牌；可在对话模型对比中同时选择 Qwen 与 DeepSeek。
- 已有未标记供应商的配置自动视为 DeepSeek，保持升级兼容。
- 缓存键已包含 Base URL 和模型，因此 DeepSeek 与千问缓存天然隔离。

## 连接测试

千问未依赖 `/models` 探测。设置页使用官方 Chat Completions 端点发送最多 1 Token 的最小请求验证 API Key、Base URL 和模型权限。

千问域名不保证允许 Electron 渲染进程跨域访问，因此千问 Chat Completions 统一由主进程发起，并限制为官方 DashScope 与 Token Plan 域名。DeepSeek 和其他现有 OpenAI 兼容配置保持原传输方式。

参考：<https://platform.qianwenai.com/docs/developer-guides/getting-started/first-api-call>
