/**
 * prompt-lab wrapper for @next-work/rss-reader.
 *
 * Hosts in @next-work/rss-reader are host-agnostic; this file wires the
 * published panel to prompt-lab's `window.electronAPI` preload bridge.
 *
 * Keep this file thin. The main-process IPC service, SQLite schema, and
 * background refresh live in `@next-work/rss-reader/main`.
 */

import React, { useMemo } from "react";
import { RssReaderPanel as PublishedRssReaderPanel, type RssReaderAdapter } from "@next-work/rss-reader/react";
import "@next-work/rss-reader/styles.css";

function createPromptLabAdapter(): RssReaderAdapter {
  return {
    api: {
      rss: window.electronAPI.rss,
      shell: window.electronAPI.shell,
      copyText: window.electronAPI.copyText,
      pickFile: (async (options: { accept?: string }) => {
        const picked = await window.electronAPI.pickFile({ accept: options?.accept, multiple: false });
        if (!picked) return null;
        return Array.isArray(picked) ? { path: picked[0]?.path ?? null, text: picked[0]?.text } : { path: picked.path, text: picked.text };
      }) as RssReaderAdapter['api']['pickFile'],
      saveFile: (async (options: { defaultName?: string; content: string }) => {
        const result = await window.electronAPI.saveFile(options.content, options.defaultName);
        return { success: result.success, path: result.path, error: result.error };
      }) as RssReaderAdapter['api']['saveFile'],
    },
  };
}

export const RssReaderPanel: React.FC = () => {
  const adapter = useMemo(() => createPromptLabAdapter(), []);
  return <PublishedRssReaderPanel adapter={adapter} />;
};
