import React, { createContext, useContext, type PropsWithChildren } from "react";
import type { RssReaderAdapter } from "./adapter";

const AdapterContext = createContext<RssReaderAdapter | null>(null);

export interface RssReaderProviderProps extends PropsWithChildren {
  adapter: RssReaderAdapter;
}

export function RssReaderProvider({ adapter, children }: RssReaderProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useRssReaderAdapter(): RssReaderAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error("RssReaderProvider is missing");
  return adapter;
}
