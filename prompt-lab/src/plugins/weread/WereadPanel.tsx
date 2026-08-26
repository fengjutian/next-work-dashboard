/**
 * prompt-lab wrapper for @next-work/weread.
 *
 * Hosts in @next-work/weread are host-agnostic; this file wires the
 * published panel to prompt-lab's concrete:
 *  - SQLite-backed weread cache (`db*Weread*` from `@/db`)
 *  - Electron preload bridge (`window.electronAPI`)
 *  - Zustand AI config (`@/store/store`)
 *
 * Keep this file thin. The main-process IPC service lives in
 * `@next-work/weread/main` and is wired in `src/main/ipc-handlers.ts`
 * via `registerWereadIpc({ ipcMain })`.
 */

import React, { useMemo } from "react";
import { WereadPanel as PublishedWereadPanel, WereadProvider, type WereadAdapter, type WereadAiConfig, type WereadTaskRepository } from "@next-work/weread/react";
import "@next-work/weread/styles.css";
import {
  dbLoadWereadActions,
  dbLoadWereadCache,
  dbLoadWereadExportStates,
  dbLoadWereadReviewStates,
  dbLoadWereadSyncHistory,
  dbMarkWereadExported,
  dbMarkWereadReviewed,
  dbReplaceWereadCache,
  dbSaveWereadAction,
  dbSearchWereadNotes,
  flushDbToDisk,
  isDbReady,
} from "@/db";
import { useStore } from "@/store/store";

function createPromptLabAdapter(aiConfig: WereadAiConfig): WereadAdapter {
  const tasks: WereadTaskRepository = {
    loadCache: (query) => dbLoadWereadCache(query ?? ""),
    replaceCache: (books) => dbReplaceWereadCache(books),
    loadExportStates: () => dbLoadWereadExportStates(),
    markExported: (states) => dbMarkWereadExported(states),
    loadReviewStates: () => dbLoadWereadReviewStates(),
    markReviewed: (bookId, intervalDays) => dbMarkWereadReviewed(bookId, intervalDays),
    loadActions: () => dbLoadWereadActions(),
    saveAction: (action) => dbSaveWereadAction(action),
    loadSyncHistory: () => dbLoadWereadSyncHistory(),
    searchNotes: (query, limit) => dbSearchWereadNotes(query, limit),
    flush: async () => { await flushDbToDisk(); },
    isReady: () => isDbReady(),
  };
  return {
    api: {
      wereadRequest: window.electronAPI.wereadRequest,
      wereadAiSummary: window.electronAPI.wereadAiSummary,
      wereadAiRecommend: window.electronAPI.wereadAiRecommend,
    },
    ai: aiConfig,
    tasks,
  };
}

export const WereadPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const adapter = useMemo(() => createPromptLabAdapter(aiApi), [aiApi]);
  return <WereadProvider adapter={adapter}><PublishedWereadPanel /></WereadProvider>;
};
