import { describe, expect, it } from 'vitest';
import {
  extractPromptVariableNames,
  fillPromptVariables,
  filterAndSortPrompts,
  normalizePromptTags,
  syncPromptVariables,
} from '../src/features/prompts/domain';
import type { Prompt } from '../src/store/types';

const makePrompt = (patch: Partial<Prompt>): Prompt => ({
  id: 'prompt', title: 'Title', content: 'Content', category: 'General', tags: [],
  variables: [], isFavorite: false, isPinned: false, usageCount: 0,
  createdAt: 1, updatedAt: 1, ...patch,
});

describe('prompt domain', () => {
  it('extracts unique variables including localized names', () => {
    expect(extractPromptVariableNames('{{ topic }} / {{语言}} / {{topic}}')).toEqual(['topic', '语言']);
  });

  it('preserves metadata while synchronizing variables with content', () => {
    expect(syncPromptVariables('{{topic}} {{tone}}', [
      { name: 'topic', defaultValue: 'AI', description: 'subject' },
      { name: 'removed', defaultValue: '', description: '' },
    ])).toEqual([
      { name: 'topic', defaultValue: 'AI', description: 'subject' },
      { name: 'tone', defaultValue: '', description: '' },
    ]);
  });

  it('fills known variables and leaves unknown variables intact', () => {
    expect(fillPromptVariables('{{ topic }} / {{tone}}', { topic: 'AI' })).toBe('AI / {{tone}}');
  });

  it('normalizes comma variants and removes duplicate tags', () => {
    expect(normalizePromptTags('AI, writing，AI, ')).toEqual(['AI', 'writing']);
  });

  it('filters by local query and applies stable priority sorting', () => {
    const prompts = [
      makePrompt({ id: 'popular', title: 'Popular', usageCount: 20 }),
      makePrompt({ id: 'favorite', title: 'Favorite', isFavorite: true }),
      makePrompt({ id: 'pinned', title: 'Pinned', isPinned: true }),
      makePrompt({ id: 'disabled', title: 'Disabled', enabled: false }),
    ];
    expect(filterAndSortPrompts(prompts, { enabledOnly: true }).map((prompt) => prompt.id))
      .toEqual(['pinned', 'favorite', 'popular']);
    expect(filterAndSortPrompts(prompts, { search: 'pop' }).map((prompt) => prompt.id))
      .toEqual(['popular']);
  });
});
