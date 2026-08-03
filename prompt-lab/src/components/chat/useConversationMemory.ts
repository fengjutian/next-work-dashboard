import { useCallback, useEffect, useState } from 'react';
import { buildMemoryContext, conversationMemory, selectMemorySourcesForBudget, toMemoryCitation, type MemoryCitation } from '@/core/conversation-memory';

const MEMORY_ENABLED_KEY = 'chat.memory.enabled';

export function useConversationMemory() {
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem(MEMORY_ENABLED_KEY) === 'true');

  useEffect(() => {
    localStorage.setItem(MEMORY_ENABLED_KEY, String(memoryEnabled));
  }, [memoryEnabled]);

  const enrichUserMessage = useCallback(async (
    text: string,
    additionalContext?: string,
  ): Promise<{ contextContent?: string; sources: MemoryCitation[] }> => {
    let retrieved = [] as Awaited<ReturnType<typeof conversationMemory.search>>;
    if (memoryEnabled) {
      try { retrieved = await conversationMemory.search(text); }
      catch { /* Retrieval failures must not block the conversation. */ }
    }
    const selected = selectMemorySourcesForBudget(retrieved);
    const memoryContext = buildMemoryContext(selected);
    const context = [memoryContext, additionalContext?.trim()].filter(Boolean).join('\n\n---\n\n');
    return {
      sources: selected.map(toMemoryCitation),
      contextContent: context ? `${context}\n\n[用户问题]\n${text}` : undefined,
    };
  }, [memoryEnabled]);

  return { memoryEnabled, setMemoryEnabled, enrichUserMessage };
}
