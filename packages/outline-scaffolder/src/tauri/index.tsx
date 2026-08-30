import React from "react";
import { OutlineScaffolderPanel } from "../react";
import type { OutlineAiConfig, OutlineScaffolderAdapter } from "../react/adapter";
import {
  createTransportOutlineScaffolderAdapter,
  type OutlineScaffolderTransport,
} from "../platform/transport";

export type TauriInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface TauriOutlineScaffolderOptions {
  invoke?: TauriInvoke;
  command?: string;
  ai?: Partial<OutlineAiConfig>;
  adapter?: OutlineScaffolderAdapter;
}

export function createTauriOutlineScaffolderTransport(
  invoke: TauriInvoke,
  command = "outline_scaffolder",
): OutlineScaffolderTransport {
  return (operation, args) => invoke(command, { operation, args });
}

export function createTauriOutlineScaffolderAdapter(
  options: TauriOutlineScaffolderOptions,
): OutlineScaffolderAdapter {
  if (options.adapter) return options.adapter;
  if (!options.invoke) {
    throw new Error("Tauri outline scaffolder requires invoke or adapter");
  }
  return createTransportOutlineScaffolderAdapter(
    createTauriOutlineScaffolderTransport(options.invoke, options.command),
    options.ai,
  );
}

export function TauriOutlineScaffolderApp({
  options,
}: {
  options: TauriOutlineScaffolderOptions;
}) {
  const adapter = React.useMemo(
    () => createTauriOutlineScaffolderAdapter(options),
    [options],
  );
  return <OutlineScaffolderPanel adapter={adapter} />;
}

export type { OutlineScaffolderTransport } from "../platform/transport";
