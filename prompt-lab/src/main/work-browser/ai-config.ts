import type { AIProviderConfig } from '../../core/work-browser/ai/summarizer';
import { loadAIConfig } from '../../core/work-browser/ai/summarizer';

let runtimeConfig: AIProviderConfig | null = null;

/**
 * Receives the application's active AI provider without persisting its secret in
 * the Work Browser database. The value intentionally lives only for this main
 * process lifetime.
 */
export function setRuntimeAIConfig(input: AIProviderConfig): void {
  runtimeConfig = {
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || '').trim(),
    local: Boolean(input.local),
  };
}

export async function resolveWorkBrowserAIConfig(
  getter: (key: string) => Promise<string | null>,
): Promise<AIProviderConfig> {
  if (runtimeConfig?.baseUrl && runtimeConfig.model) return { ...runtimeConfig };
  return loadAIConfig(getter);
}
