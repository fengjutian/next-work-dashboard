import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { CompareAdapter } from './adapter';

const AdapterContext = createContext<CompareAdapter | null>(null);

export interface CompareProviderProps extends PropsWithChildren {
  adapter: CompareAdapter;
}

export function CompareProvider({ adapter, children }: CompareProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useCompareAdapter(): CompareAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('CompareProvider is missing');
  return adapter;
}
