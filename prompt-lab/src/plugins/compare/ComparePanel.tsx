/**
 * prompt-lab wrapper for @next-work-dashboard/compare.
 *
 * The package is host-agnostic. This file wires it up to prompt-lab's:
 *  - window.electronAPI (pickFile / saveFile / writeTextFile)
 *  - Zustand store (theme + activeActivity)
 *  - Monaco setup + editor-utils (decodeBase64Utf8 / languageIdFromName)
 *  - Vite-bundled text-diff worker (`?worker` query)
 *  - `compare:open-content` window event bridge
 *
 * Keep this file thin. New host capabilities should extend
 * `CompareAdapter` rather than this wrapper.
 */

import React, { useMemo } from "react";
import {
  ComparePanel as PublishedComparePanel,
  CompareProvider,
  type CompareAdapter,
  type CompareHostWorker,
} from "@next-work-dashboard/compare/react";
import type { TextDiffWorkerRequest, TextDiffWorkerResponse } from "@next-work-dashboard/compare/core";
// eslint-disable-next-line import/default
import TextDiffWorker from "@next-work-dashboard/compare/core/text-diff.worker?worker";
import { useStore } from "@/store/store";
import { configureMonaco } from "@/lib/monaco-setup";
import { decodeBase64Utf8, languageIdFromName } from "@/plugins/code-editor/editor-utils";

function createPromptLabAdapter(): CompareAdapter {
  let requestSequence = 0;
  const hostWorker: CompareHostWorker = {
    spawnDiffWorker: () => new TextDiffWorker() as unknown as Worker,
    requestDiff: (request, signal, timeoutMs = 5000) => {
      return new Promise<TextDiffWorkerResponse>((resolve, reject) => {
        const worker = new TextDiffWorker();
        const id = ++requestSequence;
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          worker.terminate();
          callback();
        };
        const abort = () =>
          finish(() => reject(new DOMException("Diff calculation cancelled", "AbortError")));
        const timer = setTimeout(
          () => finish(() => reject(new Error("DIFF_TIMEOUT"))),
          timeoutMs,
        );
        worker.onmessage = (event: MessageEvent<TextDiffWorkerResponse>) => {
          const response = event.data;
          if (response.id !== id) return;
          if (response.success === false) finish(() => reject(new Error(response.error)));
          else finish(() => resolve(response));
        };
        worker.onerror = (event: ErrorEvent) =>
          finish(() => reject(new Error(event.message || "DIFF_WORKER_ERROR")));
        if (signal?.aborted) abort();
        else {
          signal?.addEventListener("abort", abort, { once: true });
          worker.postMessage({ ...(request as object), id } as TextDiffWorkerRequest);
        }
      });
    },
  };

  const getState = () => useStore.getState();

  return {
    api: {
      pickFile: async (options) => {
        const picked = await window.electronAPI.pickFile({
          accept: options?.accept,
          multiple: options?.multiple,
        });
        if (!picked) return null;
        return Array.isArray(picked) ? picked[0] ?? null : picked;
      },
      saveFile: (content, defaultName, options) => window.electronAPI.saveFile(content, defaultName, options),
      writeTextFile: (path, content, options) => window.electronAPI.writeTextFile(path, content, options),
    },
    store: {
      get theme() { return getState().theme; },
      get activeActivity() { return getState().activeActivity; },
      setActiveActivity: (activity) => getState().setActiveActivity(activity),
    },
    monaco: {
      configureMonaco: () => configureMonaco(),
      decodeBase64Utf8: (base64) => decodeBase64Utf8(base64),
      languageIdFromName: (name) => languageIdFromName(name),
    },
    worker: hostWorker,
    events: {
      onOpenContent: (handler) => {
        const wrap = (event: Event) => {
          const detail = (event as CustomEvent).detail ?? {};
          handler(detail);
        };
        window.addEventListener("compare:open-content", wrap);
        return () => window.removeEventListener("compare:open-content", wrap);
      },
    },
  };
}

export const ComparePanel: React.FC = () => {
  const adapter = useMemo(() => createPromptLabAdapter(), []);
  return (
    <CompareProvider adapter={adapter}>
      <PublishedComparePanel />
    </CompareProvider>
  );
};
