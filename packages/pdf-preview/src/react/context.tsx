import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { PdfPreviewAdapter } from './adapter';

const AdapterContext = createContext<PdfPreviewAdapter | null>(null);

export interface PdfPreviewProviderProps extends PropsWithChildren {
  adapter: PdfPreviewAdapter;
}

export function PdfPreviewProvider({ adapter, children }: PdfPreviewProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function usePdfPreviewAdapter(): PdfPreviewAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('PdfPreviewProvider is missing');
  return adapter;
}
