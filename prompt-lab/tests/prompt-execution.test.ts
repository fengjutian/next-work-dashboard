import { describe, expect, it } from 'vitest';
import { buildBoundPromptContent, preparePromptExecution } from '../src/features/prompts/execution';
import type { Prompt } from '../src/store/types';

const prompt = (patch: Partial<Prompt> = {}): Prompt => ({
  id: 'p1', title: 'Reviewer', content: 'Review {{language}} code', category: 'Code', tags: [],
  variables: [], isFavorite: false, isPinned: false, usageCount: 0,
  createdAt: 1, updatedAt: 1, ...patch,
});

describe('prompt execution', () => {
  it('blocks disabled prompts for every execution intent', () => {
    expect(preparePromptExecution(prompt({ enabled: false }), 'inject')).toMatchObject({
      status: 'blocked', reason: 'disabled', intent: 'inject',
    });
  });

  it('requests variable input before execution', () => {
    expect(preparePromptExecution(prompt(), 'chat')).toMatchObject({
      status: 'requires-input', variables: ['language'],
    });
  });

  it('returns rendered content after values are supplied', () => {
    expect(preparePromptExecution(prompt(), 'inject', { language: 'TypeScript' })).toMatchObject({
      status: 'ready', content: 'Review TypeScript code',
    });
  });

  it('combines bound prompts in requested order and skips missing or disabled entries', () => {
    expect(buildBoundPromptContent([
      prompt({ id: 'one', title: 'One', content: 'First' }),
      prompt({ id: 'two', title: 'Two', content: 'Second', enabled: false }),
    ], ['two', 'missing', 'one'])).toBe('[One]\nFirst');
  });
});
