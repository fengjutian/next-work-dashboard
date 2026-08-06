import { useCallback, useEffect, useState } from 'react';
import { buildMemoryContext, conversationMemory, selectMemorySourcesForBudget, toMemoryCitation, type MemoryCitation } from '@/core/conversation-memory';
import { useStore } from '@/store';

const MEMORY_ENABLED_KEY = 'chat.memory.enabled';
const MEMORY_DIRECTORIES_KEY = 'chat.memory.directories';

export interface MemoryDirectory {
  path: string;
  name: string;
}

function isPathInsideDirectory(filePath: string, directoryPath: string) {
  const file = filePath.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  const directory = directoryPath.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  return file === directory || file.startsWith(`${directory}/`);
}

export function useConversationMemory() {
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem(MEMORY_ENABLED_KEY) === 'true');
  const [memoryDirectories, setMemoryDirectories] = useState<MemoryDirectory[]>(() => {
    try { return JSON.parse(localStorage.getItem(MEMORY_DIRECTORIES_KEY) ?? '[]'); }
    catch { return []; }
  });
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
        retrieved = await conversationMemory.search(retrievalQuery, searchLimit);
        retrieved = retrieved.filter((source) => memoryDirectories.some((directory) => isPathInsideDirectory(source.filePath, directory.path)));
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
