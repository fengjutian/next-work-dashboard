import React, { createContext, useContext, type PropsWithChildren } from "react";
import type { VideoGenerationAdapter } from "./adapter";

const AdapterContext = createContext<VideoGenerationAdapter | null>(null);

export interface VideoGenerationProviderProps extends PropsWithChildren {
  adapter: VideoGenerationAdapter;
}

export function VideoGenerationProvider({ adapter, children }: VideoGenerationProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useVideoGenerationAdapter(): VideoGenerationAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error("VideoGenerationProvider is missing");
  return adapter;
}
