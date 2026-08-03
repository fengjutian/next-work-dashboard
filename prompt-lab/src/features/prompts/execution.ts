import type { Prompt } from '@/store/types';
import { extractPromptVariableNames, fillPromptVariables } from './domain';

export type PromptExecutionIntent = 'copy' | 'inject' | 'chat' | 'bind';

export type PromptExecutionResult =
  | { status: 'blocked'; reason: 'disabled'; prompt: Prompt; intent: PromptExecutionIntent }
  | { status: 'requires-input'; variables: string[]; prompt: Prompt; intent: PromptExecutionIntent }
  | { status: 'ready'; content: string; prompt: Prompt; intent: PromptExecutionIntent };

export function preparePromptExecution(
  prompt: Prompt,
  intent: PromptExecutionIntent,
  values?: Record<string, string>,
): PromptExecutionResult {
  if (prompt.enabled === false) return { status: 'blocked', reason: 'disabled', prompt, intent };

  const variables = extractPromptVariableNames(prompt.content);
  if (variables.length > 0 && values === undefined) {
    return { status: 'requires-input', variables, prompt, intent };
  }

  return {
    status: 'ready',
    content: values === undefined ? prompt.content : fillPromptVariables(prompt.content, values),
    prompt,
    intent,
  };
}

export function buildBoundPromptContent(prompts: Prompt[], promptIds: string[]): string {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return promptIds
    .map((id) => byId.get(id))
    .filter((prompt): prompt is Prompt => Boolean(prompt && prompt.enabled !== false))
    .map((prompt) => `[${prompt.title}]\n${prompt.content}`)
    .join('\n\n');
}

export function canExecutePrompt(prompt: Prompt | undefined): prompt is Prompt {
  return Boolean(prompt && prompt.enabled !== false);
}
