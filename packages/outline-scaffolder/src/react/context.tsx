import React, { createContext, useContext, type PropsWithChildren } from "react";
import type { OutlineScaffolderAdapter } from "./adapter";

const AdapterContext = createContext<OutlineScaffolderAdapter | null>(null);

export interface OutlineScaffolderProviderProps extends PropsWithChildren {
  adapter: OutlineScaffolderAdapter;
}

export function OutlineScaffolderProvider({ adapter, children }: OutlineScaffolderProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useOutlineScaffolderAdapter(): OutlineScaffolderAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error("OutlineScaffolderProvider is missing");
  return adapter;
}
