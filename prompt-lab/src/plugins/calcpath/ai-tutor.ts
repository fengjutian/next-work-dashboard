import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import type { LessonContent } from './lessons';

export type TutorDepth = '直觉' | '标准' | '严格';
export interface TutorConfig { apiKey: string; baseUrl: string; model: string }

function systemPrompt(lesson: LessonContent, mastery: number, depth: TutorDepth) {
  return `你是 CalcPath 的微积分导师。当前知识点：${lesson.title}（${lesson.stage}）。
学生掌握度约 ${Math.round(mastery * 100)}%。先修知识：${lesson.prerequisites.join('、') || '无'}。
核心洞见：${lesson.insight}
教学深度：${depth}。

规则：
1. 用中文回答，循序渐进，把高中知识明确连接到大学微积分；不要只给结论。
2. ${depth === '直觉' ? '优先用图像、运动和现实类比，少用形式化符号。' : depth === '严格' ? '给出定义、成立条件、推导，并指出常见逻辑漏洞。' : '直觉、公式和例题各占适当比例。'}
3. 每次最多讲一个核心跨越，结尾提出一个可回答的小问题检查理解。
4. 数学答案以固定课程和数学引擎为准。你不能修改掌握度、判定练习答案或声称学生已掌握。
5. 不确定时明确说明，不编造定理、公式或条件。
6. 使用简洁 Markdown；公式使用普通 Unicode 或行内表达，避免复杂 LaTeX 环境。`;
}

export async function streamTutorReply(config: TutorConfig, lesson: LessonContent, mastery: number, depth: TutorDepth, history: ChatMessage[], question: string, onChunk: (text: string) => void, signal?: AbortSignal) {
  if (!config.apiKey.trim() || !config.baseUrl.trim() || !config.model.trim()) throw new Error('请先在设置中配置 AI 服务、API Key 和模型');
  const provider = createOpenAIProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(lesson, mastery, depth) }, ...history.slice(-8), { role: 'user', content: question }];
  let result = '';
  for await (const chunk of provider.chat(messages, { model: config.model, temperature: .45, maxTokens: 1800, stream: true, signal })) {
    if (chunk.delta) { result += chunk.delta; onChunk(result); }
  }
  return result;
}
