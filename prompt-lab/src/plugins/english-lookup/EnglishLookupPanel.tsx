/**
 * prompt-lab wrapper for @next-work-dashboard/english-lookup.
 *
 * The package is host-agnostic. This file wires it to prompt-lab's:
 *  - `createOpenAIProvider` from `@/core/llm` (with qwen chatProxy injection)
 *  - `useStore` for AI config (apiKey / baseUrl / model / provider)
 *  - `window.localStorage` for vocabulary / history / review-log persistence
 *
 * Keep this file thin. Domain logic (parsing, review scheduling, vocabulary
 * graph) lives in `@next-work-dashboard/english-lookup/core`.
 */

import React, { useMemo } from "react";
import { EnglishLookupPanel as PublishedEnglishLookupPanel, EnglishLookupProvider, type EnglishLookupAdapter } from "@next-work-dashboard/english-lookup/react";
import "@next-work-dashboard/english-lookup/styles.css";
import { createOpenAIProvider } from "@/core/llm";
import { useStore } from "@/store/store";

function createPromptLabAdapter(): EnglishLookupAdapter {
  return {
    ai: {
      createChatProvider: ({ apiKey, baseUrl, provider }) => {
        const llm = createOpenAIProvider({
          apiKey,
          baseUrl,
          chatProxy: provider === "qwen" ? window.electronAPI?.llmChat : undefined,
        });
        return {
          async *chat(messages, options) {
            for await (const chunk of llm.chat(messages, options)) yield { delta: chunk.delta };
          },
        };
      },
    },
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
  };
}

export const EnglishLookupPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const adapter = useMemo(() => createPromptLabAdapter(), []);
  return (
    <EnglishLookupProvider adapter={adapter}>
      <PublishedEnglishLookupPanel ai={aiApi} />
    </EnglishLookupProvider>
  );
};
