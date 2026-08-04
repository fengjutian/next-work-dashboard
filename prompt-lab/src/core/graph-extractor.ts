// ── 知识图谱 AI 实体抽取引擎 ──
// 职责：调用 LLM 从文档文本中抽取关键实体和关系

import { createOpenAIProvider } from '@/core/llm';
import type { LLMProvider, ChatMessage } from '@/core/llm';
import type { ExtractedEntity, ExtractedRelation, ExtractResult, ExtractOptions } from '@/plugins/knowledge-graph/graph-types';

// ── 策略对应的 System Prompt ──

const STRATEGY_PROMPTS: Record<ExtractOptions['strategy'], string> = {
  keyword: `你是一个技术关键词抽取器。从文档中提取关键技术名词/术语。不要输出分析过程或解释，直接输出结果。
输出严格 JSON，不要 markdown 代码块标记：
{ "entities": [{ "name": "关键词", "category": "分类", "relevance": 0.9, "context": "原文片段" }] }
categories: 技术栈, 架构概念, 业务术语, 工具链, 文件模块`,
  entity: `你是一个知识图谱实体抽取器。从文档中提取关键实体并精确分类。不要输出分析过程或解释，直接输出结果。
输出严格 JSON，不要 markdown 代码块标记：
{ "entities": [{ "name": "实体名", "category": "分类", "aliases": ["别名"], "relevance": 0.9, "context": "原文片段" }] }
categories: 技术栈, 架构概念, 业务术语, 工具链, 文件模块, 设计模式, 数据模型`,
  'concept-relation': `你是一个知识图谱实体和关系抽取器。从文档中提取关键实体及其之间的关系。不要输出分析过程或解释，直接输出结果。
输出严格 JSON，不要 markdown 代码块标记：
{ "entities": [{ "name": "实体名", "category": "分类", "relevance": 0.9, "context": "原文片段" }], "relations": [{ "source": "实体A", "target": "实体B", "label": "关系描述" }] }
categories: 技术栈, 架构概念, 业务术语, 工具链, 文件模块, 设计模式
relation labels 示例: 依赖, 使用, 实现, 调用, 配置, 包含`,
};

// ── 文档拼接辅助 ──

function buildUserMessage(
  documents: { name: string; content: string }[],
  options: ExtractOptions,
): string {
  const maxEntities = options.maxEntities ?? 20;
  const docsText = documents
    .map((d, i) => `--- 文档 ${i + 1}: ${d.name} ---\n${d.content.slice(0, 2500)}`)
    .join('\n\n');

  const basePrompt = options.customPrompt
    ? options.customPrompt
    : `请从以下文档中提取最多 ${maxEntities} 个关键实体${options.strategy === 'concept-relation' ? '及其关系' : ''}。`;

  return `${basePrompt}\n\n${docsText}`;
}

// ── JSON 解析容错 ──

/**
 * 尝试多种策略将 LLM 返回文本解析为 ExtractResult：
 * 1. 直接 JSON.parse
 * 2. 剥离 markdown ``` 代码块后 JSON.parse
 * 3. 正则提取首个 JSON 对象（非贪婪）
 * 4. 修复截断的 JSON（补全未闭合的括号/引号）
 */
function tryParseJson(text: string): ExtractResult | null {
  let cleaned = text.trim();

  // ── 策略 A：直接解析 ──
  const directResult = parseResult(cleaned);
  if (directResult) return directResult;

  // ── 策略 B：剥离 markdown 代码块 ──
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const blockResult = parseResult(codeBlockMatch[1].trim());
    if (blockResult) return blockResult;
  }

  // ── 策略 C：提取首个 JSON 对象（非贪婪，找到配对的 { }） ──
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let endIdx = -1;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx !== -1) {
      const jsonStr = cleaned.slice(firstBrace, endIdx + 1);
      const braceResult = parseResult(jsonStr);
      if (braceResult) return braceResult;
    }

    // ── 策略 D：JSON 被截断 → 尝试修复 ──
    // 深度 > 0 说明 JSON 未完整闭合，尝试补全
    if (depth > 0) {
      let repaired = tryRepairTruncatedJson(cleaned.slice(firstBrace));
      // 结构修复后仍可能 JSON 非法（如残缺 key-value {"key"}），
      // 循环剔除末尾残缺条目重试
      while (repaired) {
        const repairResult = parseResult(repaired);
        if (repairResult) return repairResult;
        repaired = trimLastIncompleteEntry(repaired);
      }
    }
  }

  return null;
}

/** 尝试修复因 maxTokens 不足被截断的 JSON */
function tryRepairTruncatedJson(jsonStr: string): string | null {
  let repaired = jsonStr.trimEnd();
  if (!repaired) return null;

  // 使用栈追踪嵌套 — 需要逆序闭合
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"' && !inString) { inString = true; continue; }
    if (ch === '"' && inString) { inString = false; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '}') { if (stack[stack.length - 1] === '}') stack.pop(); }
    else if (ch === '[') stack.push(']');
    else if (ch === ']') { if (stack[stack.length - 1] === ']') stack.pop(); }
  }

  // 如果仍然在字符串内，关闭字符串
  if (inString) repaired += '"';

  // 逆序闭合所有未闭合的括号（栈顶是最后打开的）
  if (stack.length > 0) repaired += stack.reverse().join('');

  // 去掉末尾可能残留的逗号
  repaired = repaired.replace(/,\s*$/, '');

  return repaired;
}

/**
 * 移除末尾残缺的条目（如被截断的 key-value 对 {"key"}），
 * 然后重新闭合括号。返回 null 表示无法进一步裁剪。
 */
function trimLastIncompleteEntry(jsonStr: string): string | null {
  // 去掉末尾闭合括号，找到最后一个可能不完整的条目边界
  let s = jsonStr.trimEnd();

  // 剥掉末尾的闭合括号（它们是 tryRepairTruncatedJson 补上去的）
  let closing = '';
  while (s.endsWith('}') || s.endsWith(']')) {
    closing = s[s.length - 1] + closing;
    s = s.slice(0, -1);
  }
  // 剥掉尾随空白
  s = s.trimEnd();

  // 找到最后一个条目边界：往前找最近的结构分隔符
  // 在对象中找最后一个 `,` 或 `{`（对象开头）
  // 在数组中找最后一个 `,` 或 `[`（数组开头）
  const lastComma = s.lastIndexOf(',');
  const lastOpenObj = s.lastIndexOf('{');
  const lastOpenArr = s.lastIndexOf('[');

  let cutAt = -1;
  if (lastComma > lastOpenObj && lastComma > lastOpenArr) {
    // 有逗号分隔符，在逗号处截断（移除逗号后的残缺条目）
    cutAt = lastComma;
  } else if (lastOpenObj > lastOpenArr && lastOpenObj > -1) {
    // 对象内第一个条目就断了，移除整个对象内容回到 {
    cutAt = lastOpenObj;
  } else if (lastOpenArr > lastOpenObj && lastOpenArr > -1) {
    // 数组内第一个元素就断了
    cutAt = lastOpenArr;
  }

  if (cutAt === -1) return null; // 无法裁剪

  s = s.slice(0, cutAt);
  // 先清掉末尾逗号，再拼接剥离的闭合括号
  s = s.replace(/,\s*$/, '');
  s += closing;

  return s || null;
}

/** 将 JSON 字符串解析为 ExtractResult，统一做字段校验和转换 */
function parseResult(jsonStr: string): ExtractResult | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.entities || !Array.isArray(parsed.entities)) return null;
    return {
      entities: parsed.entities
        .filter((e: any) => e && typeof e.name === 'string' && e.name.trim())
        .map((e: any) => ({
          name: String(e.name ?? '').trim(),
          category: String(e.category ?? '未分类'),
          aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : undefined,
          relevance: typeof e.relevance === 'number' ? Math.min(1, Math.max(0, e.relevance)) : 0.5,
          context: e.context ? String(e.context) : undefined,
        })),
      relations: Array.isArray(parsed.relations)
        ? parsed.relations
            .filter((r: any) => r && r.source && r.target)
            .map((r: any) => ({
              source: String(r.source ?? ''),
              target: String(r.target ?? ''),
              label: String(r.label ?? ''),
            }))
        : undefined,
    };
  } catch {
    return null;
  }
}

// ── 主抽取函数 ──

export interface ExtractConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function extractFromDocuments(
  documents: { name: string; content: string }[],
  options: ExtractOptions,
  config: ExtractConfig,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const provider: LLMProvider = createOpenAIProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  const systemPrompt = STRATEGY_PROMPTS[options.strategy];
  const userMessage = buildUserMessage(documents, options);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let fullResponse = '';
  let reasoningResponse = '';
  for await (const chunk of provider.chat(messages, {
    model: config.model,
    temperature: 0.2,
    maxTokens: 12_000,
    signal,
    responseFormat: 'json_object',
  })) {
    fullResponse += chunk.delta;
    reasoningResponse += chunk.reasoningDelta ?? '';
  }

  // 部分 OpenAI 兼容服务接受 stream=true，但返回空流；自动使用非流式重试。
  if (!fullResponse.trim()) {
    for await (const chunk of provider.chat(messages, {
      model: config.model,
      temperature: 0.2,
      maxTokens: 12_000,
      signal,
      stream: false,
      responseFormat: 'json_object',
    })) {
      fullResponse += chunk.delta;
      reasoningResponse += chunk.reasoningDelta ?? '';
    }
  }

  // 某些推理模型把结构化结果放入 reasoning_content，正文 content 为空。
  if (!fullResponse.trim() && reasoningResponse.trim()) fullResponse = reasoningResponse;

  const result = tryParseJson(fullResponse);
  if (!result) {
    if (!fullResponse.trim()) {
      throw new Error('模型返回了空内容。请检查 API Base URL、模型名称及该服务是否支持 /chat/completions。');
    }
    throw new Error(
      `LLM 返回无法解析为 JSON。\n` +
      `响应开头 (200字): ${fullResponse.slice(0, 200)}\n` +
      `响应结尾 (100字): ${fullResponse.slice(-100)}`
    );
  }

  return result;
}

// ── 非流式快速抽取（不暴露中间 chunk） ──

export async function quickExtract(
  documents: { name: string; content: string }[],
  options: ExtractOptions,
  config: ExtractConfig,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  return extractFromDocuments(documents, options, config, signal);
}
