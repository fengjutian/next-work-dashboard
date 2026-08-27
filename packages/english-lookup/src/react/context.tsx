import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { EnglishLookupAdapter } from './adapter';

const AdapterContext = createContext<EnglishLookupAdapter | null>(null);

export interface EnglishLookupProviderProps extends PropsWithChildren {
  adapter: EnglishLookupAdapter;
}

export function EnglishLookupProvider({ adapter, children }: EnglishLookupProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useEnglishLookupAdapter(): EnglishLookupAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('EnglishLookupProvider is missing');
  return adapter;
}
