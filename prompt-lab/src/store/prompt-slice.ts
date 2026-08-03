import type { StoreApi } from 'zustand';
import type { Prompt } from './types';
import { DEFAULT_PROMPTS } from './defaultPrompts';
import {
  dbBatchDeletePrompts,
  dbDeletePrompt,
  dbInsertInjectHistory,
  dbInsertPrompt,
  dbUpdatePrompt,
  isDbReady,
} from '@/db';

export interface PromptSlice {
  prompts: Prompt[];
  selectedPromptId: string | null;
  injectHistory: { promptId: string; siteId: string; timestamp: number }[];
  addPrompt: (prompt: Prompt) => void;
  updatePrompt: (id: string, patch: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;
  batchDeletePrompts: (ids: string[]) => void;
  selectPrompt: (id: string | null) => void;
  incrementUsage: (id: string) => void;
  recordInject: (promptId: string, siteId: string) => void;
}

export function createPromptSlice<T extends PromptSlice>(set: StoreApi<T>['setState']): PromptSlice {
  return {
    prompts: DEFAULT_PROMPTS,
    selectedPromptId: null,
    injectHistory: [],

    addPrompt: (prompt) => {
      if (isDbReady()) dbInsertPrompt(prompt);
      set((state) => ({ prompts: [...state.prompts, prompt] } as Partial<T>));
    },

    updatePrompt: (id, patch) => {
      const updatedAt = Date.now();
      if (isDbReady()) dbUpdatePrompt(id, { ...patch, updatedAt });
      set((state) => ({
        prompts: state.prompts.map((prompt) => prompt.id === id
          ? { ...prompt, ...patch, updatedAt }
          : prompt),
      } as Partial<T>));
    },

    deletePrompt: (id) => {
      if (isDbReady()) dbDeletePrompt(id);
      set((state) => ({
        prompts: state.prompts.filter((prompt) => prompt.id !== id),
        selectedPromptId: state.selectedPromptId === id ? null : state.selectedPromptId,
      } as Partial<T>));
    },

    batchDeletePrompts: (ids) => {
      if (isDbReady()) dbBatchDeletePrompts(ids);
      const idSet = new Set(ids);
      set((state) => ({
        prompts: state.prompts.filter((prompt) => !idSet.has(prompt.id)),
        selectedPromptId: state.selectedPromptId && idSet.has(state.selectedPromptId)
          ? null
          : state.selectedPromptId,
      } as Partial<T>));
    },

    selectPrompt: (id) => set({ selectedPromptId: id } as Partial<T>),

    incrementUsage: (id) => {
      set((state) => {
        const updatedAt = Date.now();
        const prompts = state.prompts.map((prompt) => prompt.id === id
          ? { ...prompt, usageCount: prompt.usageCount + 1, updatedAt }
          : prompt);
        const target = prompts.find((prompt) => prompt.id === id);
        if (target && isDbReady()) dbUpdatePrompt(id, { usageCount: target.usageCount, updatedAt });
        return { prompts } as Partial<T>;
      });
    },

    recordInject: (promptId, siteId) => {
      const timestamp = Date.now();
      if (isDbReady()) dbInsertInjectHistory({ promptId, siteId, success: true, timestamp });
      set((state) => ({
        injectHistory: [{ promptId, siteId, timestamp }, ...state.injectHistory].slice(0, 100),
      } as Partial<T>));
    },
  };
}
