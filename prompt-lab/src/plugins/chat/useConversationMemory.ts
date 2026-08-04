import { useCallback, useEffect, useState } from 'react';
import { buildMemoryContext, conversationMemory, selectMemorySourcesForBudget, toMemoryCitation, type MemoryCitation } from '@/core/conversation-memory';
import { useStore } from '@/store';

const MEMORY_ENABLED_KEY = 'chat.memory.enabled';

export function useConversationMemory() {
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem(MEMORY_ENABLED_KEY) === 'true');
  const memoryConfig = useStore((state) => state.memoryConfig);
  const setMemoryConfig = useStore((state) => state.setMemoryConfig);

  useEffect(() => {
    localStorage.setItem(MEMORY_ENABLED_KEY, String(memoryEnabled));
  }, [memoryEnabled]);

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
    if (memoryEnabled) {
      try {
        const manualEnabled = localStorage.getItem('chat.manual-memory.enabled') !== 'false';
        retrieved = await conversationMemory.search(retrievalQuery, manualEnabled ? memoryConfig.recallCount : memoryConfig.recallCount * 3);
      }
      catch { /* Retrieval failures must not block the conversation. */ }
    }
    // 过滤手动记忆：当手动记忆检索开关关闭时，排除 sourceType === 'manual'
    const manualMemoryEnabled = localStorage.getItem('chat.manual-memory.enabled') !== 'false';
    const filtered = manualMemoryEnabled ? retrieved : retrieved.filter((r) => r.sourceType !== 'manual');
    const selected = selectMemorySourcesForBudget(filtered.slice(0, memoryConfig.recallCount), memoryConfig.contextBudget);
    const memoryContext = buildMemoryContext(selected, memoryConfig.contextBudget);
    const context = [memoryContext, additionalContext?.trim()].filter(Boolean).join('\n\n---\n\n');
    return {
      sources: selected.map(toMemoryCitation),
      contextContent: context ? `${context}\n\n[用户问题]\n${text}` : undefined,
    };
  }, [memoryEnabled, memoryConfig]);

  return { memoryEnabled, setMemoryEnabled, enrichUserMessage };
}
