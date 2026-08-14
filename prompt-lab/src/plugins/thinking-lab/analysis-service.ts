import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { FRAMEWORK_BY_ID } from './framework-registry';
import type { AiContext, FrameworkResult, ThinkingFrameworkId } from './thinking-types';

async function collect(messages: ChatMessage[], ai: AiContext, temperature: number, maxTokens: number, signal?: AbortSignal, onDelta?: (text: string) => void) {
  const provider = createOpenAIProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl });
  let content = '';
  for await (const chunk of provider.chat(messages, { model: ai.model, temperature, maxTokens, stream: true, signal })) {
    if (!chunk.delta) continue;
    content += chunk.delta;
    onDelta?.(content);
  }
  if (!content.trim()) throw new Error('模型没有返回内容');
  return content.trim();
}

export async function runFramework(
  frameworkId: ThinkingFrameworkId,
  question: string,
  context: string,
  ai: AiContext,
  signal?: AbortSignal,
  onDelta?: (content: string) => void,
): Promise<FrameworkResult> {
  const item = FRAMEWORK_BY_ID.get(frameworkId);
  if (!item) throw new Error(`未知分析框架：${frameworkId}`);
  const content = await collect([
    { role: 'system', content: `你是严谨的${item.name}专家。${item.prompt}\n\n要求：明确区分事实、假设与推断；不得编造数据；信息不足时明确指出；给出可执行且有条件边界的结论。使用简洁 Markdown。` },
    { role: 'user', content: `待分析问题：\n${question}\n\n补充背景：\n${context.trim() || '无'}\n\n输出：核心判断、分析过程、主要风险、行动建议、仍需验证的信息。` },
  ], ai, item.temperature, 1800, signal, onDelta);
  return { frameworkId, status: 'done', content };
}

export async function synthesizeAnalyses(
  question: string,
  results: FrameworkResult[],
  ai: AiContext,
  signal?: AbortSignal,
  onDelta?: (content: string) => void,
) {
  const material = results.filter((item) => item.status === 'done').map((item) => {
    const name = FRAMEWORK_BY_ID.get(item.frameworkId)?.name ?? item.frameworkId;
    return `## ${name}\n${item.content}`;
  }).join('\n\n');
  if (!material) throw new Error('没有可用于综合的分析结果');
  return collect([
    { role: 'system', content: '你是决策委员会主席。综合多个独立分析，但不要用多数意见掩盖关键少数观点。明确区分事实、推断和价值判断，不得制造虚假的精确概率。' },
    { role: 'user', content: `问题：${question}\n\n各框架分析：\n${material}\n\n请输出 Markdown，包含：\n1. 执行摘要\n2. 一致意见\n3. 关键分歧\n4. 被忽略的风险或盲点\n5. 推荐决策及适用条件\n6. 按优先级排序的行动清单\n7. 最值得补充的证据` },
  ], ai, 0.25, 2200, signal, onDelta);
}
