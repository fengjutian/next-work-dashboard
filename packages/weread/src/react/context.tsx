import React, { createContext, useContext, type PropsWithChildren } from "react";
import type { WereadAdapter } from "./adapter";

const AdapterContext = createContext<WereadAdapter | null>(null);

export interface WereadProviderProps extends PropsWithChildren {
  adapter: WereadAdapter;
}

export function WereadProvider({ adapter, children }: WereadProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useWereadAdapter(): WereadAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error("WereadProvider is missing");
  return adapter;
}
