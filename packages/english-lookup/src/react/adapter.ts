import type { EnglishLookupStorage } from '../core/storage';

/** Minimum chat-message contract the panel needs. Host adapter maps
 *  its richer LLM types onto this shape. */
export interface EnglishLookupChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimum chat-options contract. */
export interface EnglishLookupChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

/** Chat provider returned by the AI adapter. Streams delta tokens. */
export interface EnglishLookupChatProvider {
  chat(messages: EnglishLookupChatMessage[], options: EnglishLookupChatOptions): AsyncIterable<{ delta: string }>;
}

/** Factory the panel calls to obtain a chat provider. The host wraps its
 *  own LLM client (e.g. prompt-lab's `createOpenAIProvider`) and adapts
 *  the wire types. */
export interface EnglishLookupAiAdapter {
  createChatProvider(config: { apiKey: string; baseUrl: string; model: string; provider?: string }): EnglishLookupChatProvider;
}

export interface EnglishLookupAdapter {
  ai: EnglishLookupAiAdapter;
  storage: EnglishLookupStorage;
}
