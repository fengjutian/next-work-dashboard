import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { ScreenCaptureAdapter } from './adapter';

const AdapterContext = createContext<ScreenCaptureAdapter | null>(null);

export interface ScreenCaptureProviderProps extends PropsWithChildren {
  adapter: ScreenCaptureAdapter;
}

export function ScreenCaptureProvider({ adapter, children }: ScreenCaptureProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useScreenCaptureAdapter(): ScreenCaptureAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('ScreenCaptureProvider is missing');
  return adapter;
}
