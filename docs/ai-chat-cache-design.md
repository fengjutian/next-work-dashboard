# AI 对话缓存设计与实施方案

## 目标

为 AI 对话模块增加可观测、可失效、默认安全的本地缓存，在不改变现有流式交互的前提下降低重复模型请求、Token 消耗和首字响应时间。

第一阶段采用“进程内 LRU + 本地 SQLite 精确缓存 + 并发请求合并”。语义缓存复用项目已有的 LanceDB 和本地 Embedding，但必须先以影子模式收集数据，再按准确率灰度开放。

## 当前接入点

- 普通对话统一经过 `src/core/llm.ts` 的 `LLMProvider.chat()`。
- `src/plugins/chat/useChatSession.ts` 在调用 Provider 前完成系统提示词、历史消息、Prompt、Skill 和知识库上下文组装。
- Agent 在 `src/core/agent.ts` 中执行工具调用，结果具有实时性或副作用，第一阶段全部绕过响应缓存。
- 项目已有 sql.js、LanceDB 和本地 Embedding，可避免引入额外 Redis 服务。

## 分层架构

```text
Chat / Compare
      │
      ▼
CachingLLMProvider
      ├── L1：内存 LRU（热点）
      ├── L2：SQLite 精确缓存（持久化）
      ├── L3：LanceDB 语义缓存（后续灰度）
      └── Miss → OpenAICompatibleProvider → 写回缓存

Agent / tool calling ────────────────→ 直接调用 Provider
```

## 精确缓存键

缓存键为以下规范化数据的 SHA-256：

```text
schemaVersion + providerId + providerScope + model
+ messages + temperature + maxTokens + responseFormat + tools
```

规则：

- 对象键稳定排序，数组和消息顺序保持不变。
- 统一换行符并移除文本尾部空白，不压缩正文中的有效空格。
- `AbortSignal`、UI 消息 ID、时间戳不进入键。
- API Key 不进入键；使用 Base URL 的非敏感 provider scope 隔离服务。
- 系统提示词、Skill、Prompt、知识库召回后的 `contextContent` 都已包含在最终 messages 中，因此自然参与失效。
- model、temperature、maxTokens、response format 或工具 schema 变化均不命中。

## 第一阶段策略

### 可缓存

- 普通 Chat，无 tool schema。
- 完整且正常结束的文本/推理响应。
- 多模型对比按模型分别计算缓存键。

### 绕过

- Agent 和所有携带 tools 的调用。
- 用户主动“重新生成”（需要新答案）。
- 中断、异常、空响应。
- temperature 高于可配置上限的请求（首版默认仍允许精确匹配，因为请求完全一致；后续可提供策略开关）。

### 默认值

- L1 最大 200 条，TTL 30 分钟。
- L2 TTL 7 天，最大 5000 条。
- 淘汰顺序：过期条目优先，其次最久未访问。
- 命中后按小块重新产生异步流，保持 UI 的流式消费协议。
- 相同 key 的并发 Miss 合并为一次模型请求，其余请求等待并复用完整结果。

## 指标

记录：

- `eligibleRequests`：可缓存请求数
- `memoryHits`：L1 命中
- `persistentHits`：L2 命中
- `coalescedHits`：合并到在途请求
- `misses`：可缓存但未命中
- `bypasses`：策略主动绕过
- `writes`：成功写入
- `errors`：缓存层错误（不能影响模型调用）

计算：

```text
精确命中率 = (memoryHits + persistentHits) / eligibleRequests
有效避免请求率 = (memoryHits + persistentHits + coalescedHits) / eligibleRequests
```

指标分母不包含 Agent 等主动绕过请求。

## 语义缓存阶段

仅考虑低风险、无工具、无附件、无时效性内容的单轮或短对话，并先按 provider、model、scene、systemPromptHash、memoryScopeHash 过滤。

- similarity >= 0.97：候选直接命中（灰度后）。
- 0.94～0.97：影子候选，只记录不返回。
- < 0.94：Miss。

上线前从真实请求建立“应命中/不应命中”数据集，要求语义命中准确率至少 99%，错误命中率低于 0.5%。阈值必须通过样本评估调整，不能只凭固定经验值。

## 数据安全

- 缓存仅保存在本地数据库，不存 API Key 和 Authorization Header。
- 日志和指标不记录对话正文。
- 提供启用开关、TTL、容量、统计和一键清空。
- 删除缓存不影响对话历史。
- 后续增加私密会话/单次请求绕过开关。

## 实施顺序

1. 增加缓存核心、稳定键、L1、SQLite L2 和 singleflight。
2. 普通 Chat 接入，Agent 保持绕过；重新生成显式绕过读取。
3. 增加设置、统计、清空能力及单元测试。
4. Embedding 按 `backend + baseUrl/model + normalizedText` 的 SHA-256 持久化，索引和查询只计算缺失输入。
5. 收集命中数据，再实现语义缓存影子模式。

## 社区方案参考

- GPTCache：精确、Embedding 距离及模型评估三类匹配，支持 LRU/FIFO。
- RedisVL SemanticCache：距离阈值、TTL、过滤字段及阈值优化。
- LiteLLM：本地、Redis、Redis Semantic、Qdrant 等多种响应缓存后端。
- LangChain/模型供应商 Prompt Caching：通过稳定重复前缀降低输入 Token 成本；它与应用响应缓存互补。
