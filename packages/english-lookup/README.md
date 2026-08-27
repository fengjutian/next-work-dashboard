# @next-work-dashboard/english-lookup

Reusable English vocabulary lookup panel — AI dictionary lookup, sentence translation, article reader, spaced-repetition review, and vocabulary relationship graph.

## Layers

- `core/` — Pure functions: word/sentence AI response parsing, vocabulary normalization, review scheduling, CSV/JSON import-export, vocabulary graph builder, learning activity. No React, no host API.
- `react/` — `<EnglishLookupPanel />` plus adapter contract for AI provider, storage, and webview. Pure UI; host supplies capabilities via `EnglishLookupAdapter`.
- `styles.css` — CSS variables + Button styles. Hosts should import once before mounting the panel.

## Adapter contract

```ts
interface EnglishLookupAdapter {
  ai: {
    createChatProvider(config: {
      apiKey: string;
      baseUrl: string;
      model: string;
      provider?: string;
    }): {
      chat(messages: EnglishLookupChatMessage[], options: EnglishLookupChatOptions): AsyncIterable<{ delta: string }>;
    };
  };
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}
```

## Quick start (prompt-lab host)

```tsx
import { EnglishLookupPanel, EnglishLookupProvider, createLocalStorageAdapter, createOpenAiChatFactory } from '@next-work-dashboard/english-lookup/react';
import '@next-work-dashboard/english-lookup/styles.css';

const adapter = {
  ai: { createChatProvider: createOpenAiChatFactory() },
  storage: createLocalStorageAdapter(),
};

<EnglishLookupProvider adapter={adapter}>
  <EnglishLookupPanel />
</EnglishLookupProvider>
```

`createOpenAiChatFactory()` is a convenience helper that calls prompt-lab's `@/core/llm#createOpenAIProvider` and adapts the wire types.

## License

MIT
