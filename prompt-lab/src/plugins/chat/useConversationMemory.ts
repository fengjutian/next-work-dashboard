import { useCallback, useEffect, useState } from 'react';
import { buildMemoryContext, conversationMemory, selectMemorySourcesForBudget, toMemoryCitation, type MemoryCitation } from '@/core/conversation-memory';
import {
  getSelectedKnowledgeFilePaths,
  MEMORY_DIRECTORIES_KEY,
  normalizeMemoryFilePath,
  readMemoryDirectories,
  type MemoryDirectory,
} from '@/core/memory-scope';
import { useStore } from '@/store';

const MEMORY_ENABLED_KEY = 'chat.memory.enabled';
export type { MemoryDirectory } from '@/core/memory-scope';

export function useConversationMemory() {
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem(MEMORY_ENABLED_KEY) === 'true');
  const [memoryDirectories, setMemoryDirectories] = useState<MemoryDirectory[]>(readMemoryDirectories);
  const memoryConfig = useStore((state) => state.memoryConfig);
  const setMemoryConfig = useStore((state) => state.setMemoryConfig);

  useEffect(() => {
    localStorage.setItem(MEMORY_ENABLED_KEY, String(memoryEnabled));
  }, [memoryEnabled]);

  useEffect(() => {
    localStorage.setItem(MEMORY_DIRECTORIES_KEY, JSON.stringify(memoryDirectories));
  }, [memoryDirectories]);

  useEffect(() => {
    conversationMemory.configure(memoryConfig);
  }, [memoryConfig]);

  useEffect(() => {
    if (memoryConfig.embeddingApiKey) return;
    void window.electronAPI.auth.getToken('memory-embedding').then((key) => {
      if (key) setMemoryConfig({ embeddingApiKey: key });
    });
  }, [memoryConfig.embeddingApiKey, setMemoryConfig]);

  const enrichUserMessage = useCallback(async (
    text: string,
    additionalContext?: string,
    retrievalQuery = text,
  ): Promise<{ contextContent?: string; sources: MemoryCitation[] }> => {
    let retrieved = [] as Awaited<ReturnType<typeof conversationMemory.search>>;
    if (memoryEnabled && memoryDirectories.length > 0) {
      try {
        const searchLimit = Math.max(memoryConfig.recallCount * 5, 20);
        const allowedPaths = await getSelectedKnowledgeFilePaths(memoryDirectories);
        retrieved = await conversationMemory.search(retrievalQuery, searchLimit, allowedPaths);
        retrieved = retrieved.filter((source) => allowedPaths.has(normalizeMemoryFilePath(source.filePath)));
      }
      catch { /* Retrieval failures must not block the conversation. */ }
    }
    // 过滤手动记忆：当手动记忆检索开关关闭时，排除 sourceType === 'manual'
    const selected = selectMemorySourcesForBudget(retrieved.slice(0, memoryConfig.recallCount), memoryConfig.contextBudget);
    const memoryContext = buildMemoryContext(selected, memoryConfig.contextBudget);
    const context = [memoryContext, additionalContext?.trim()].filter(Boolean).join('\n\n---\n\n');
    return {
      sources: selected.map(toMemoryCitation),
      contextContent: context ? `${context}\n\n[用户问题]\n${text}` : undefined,
    };
  }, [memoryDirectories, memoryEnabled, memoryConfig]);

  return { memoryEnabled, setMemoryEnabled, memoryDirectories, setMemoryDirectories, enrichUserMessage };
}
