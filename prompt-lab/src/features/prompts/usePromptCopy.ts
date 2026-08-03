import { useCallback, useState } from 'react';
import type { Prompt } from '@/store/types';
import { preparePromptExecution } from './execution';

interface PromptCopyOptions {
  onCopied?: (prompt: Prompt) => void;
  onBlocked?: (prompt: Prompt) => void;
}

async function writeClipboard(content: string): Promise<void> {
  if (window.electronAPI?.copyText) {
    await window.electronAPI.copyText(content);
    return;
  }
  await navigator.clipboard.writeText(content);
}

export function usePromptCopy(options: PromptCopyOptions = {}) {
  const [promptToFill, setPromptToFill] = useState<Prompt | null>(null);

  const copyReadyExecution = useCallback(async (prompt: Prompt, content: string) => {
    await writeClipboard(content);
    options.onCopied?.(prompt);
  }, [options]);

  const requestCopy = useCallback(async (prompt: Prompt) => {
    const execution = preparePromptExecution(prompt, 'copy');
    if (execution.status === 'blocked') {
      options.onBlocked?.(prompt);
      return;
    }
    if (execution.status === 'requires-input') {
      setPromptToFill(prompt);
      return;
    }
    await copyReadyExecution(prompt, execution.content);
  }, [copyReadyExecution, options]);

  const confirmCopy = useCallback(async (values: Record<string, string>) => {
    if (!promptToFill) return;
    const execution = preparePromptExecution(promptToFill, 'copy', values);
    setPromptToFill(null);
    if (execution.status === 'ready') await copyReadyExecution(promptToFill, execution.content);
  }, [copyReadyExecution, promptToFill]);

  return {
    promptToFill,
    requestCopy,
    confirmCopy,
    cancelCopy: () => setPromptToFill(null),
  };
}
