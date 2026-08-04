import { estimateTokens } from './ai-context';

export interface AiConversationMessage { role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }
export interface AiPendingRequest { id: string; instruction: string; startedAt: number; status: 'running' | 'interrupted' }

export function conversationNeedsSummary(messages: AiConversationMessage[], tokenBudget: number): boolean {
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0) > tokenBudget * 0.45;
}

export function applyConversationSummary(messages: AiConversationMessage[], summary: string): AiConversationMessage[] {
  return [{ role: 'system', content: `历史会话摘要：${summary.trim()}`, timestamp: Date.now() }, ...messages.slice(-4)];
}

export function recoverInterruptedRequest(request?: AiPendingRequest): AiPendingRequest | undefined {
  return request?.status === 'running' ? { ...request, status: 'interrupted' } : request;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
