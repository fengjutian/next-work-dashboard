import React from "react";
import { OutlineScaffolderPanel } from "../react";
import type { OutlineAiConfig, OutlineScaffolderAdapter } from "../react/adapter";
import {
  createTransportOutlineScaffolderAdapter,
  type OutlineScaffolderTransport,
} from "../platform/transport";

export interface HttpOutlineScaffolderTransportOptions {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
}

export function createHttpOutlineScaffolderTransport(
  options: HttpOutlineScaffolderTransportOptions,
): OutlineScaffolderTransport {
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new Error("Web outline scaffolder requires fetch");

  return async (operation, args) => {
    const headers = typeof options.headers === "function"
      ? await options.headers()
      : options.headers;
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
    const response = await fetcher(options.endpoint, {
      method: "POST",
      credentials: options.credentials,
      headers: requestHeaders,
      body: JSON.stringify({ operation, args }),
    });
    const payload = await response.json().catch(() => undefined) as
      | { result?: unknown; error?: string }
      | undefined;
    if (!response.ok) {
      throw new Error(payload?.error || `Outline host request failed (${response.status})`);
    }
    if (payload && "error" in payload && payload.error) throw new Error(payload.error);
    return payload && "result" in payload ? payload.result : payload;
  };
}

export interface WebOutlineScaffolderOptions {
  ai?: Partial<OutlineAiConfig>;
  adapter?: OutlineScaffolderAdapter;
  transport?: OutlineScaffolderTransport;
  http?: HttpOutlineScaffolderTransportOptions;
}

export function createWebOutlineScaffolderAdapter(
  options: WebOutlineScaffolderOptions,
): OutlineScaffolderAdapter {
  if (options.adapter) return options.adapter;
  const transport = options.transport ?? (options.http
    ? createHttpOutlineScaffolderTransport(options.http)
    : undefined);
  if (!transport) {
    throw new Error("Web outline scaffolder requires adapter, transport, or http options");
  }
  return createTransportOutlineScaffolderAdapter(transport, options.ai);
}

export function WebOutlineScaffolderApp({
  options,
}: {
  options: WebOutlineScaffolderOptions;
}) {
  const adapter = React.useMemo(
    () => createWebOutlineScaffolderAdapter(options),
    [options],
  );
  return <OutlineScaffolderPanel adapter={adapter} />;
}

export type { OutlineScaffolderTransport } from "../platform/transport";
