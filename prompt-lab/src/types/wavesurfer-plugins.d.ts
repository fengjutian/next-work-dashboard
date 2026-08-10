declare module 'wavesurfer.js/plugins/regions' {
  type Region = { id: string; start: number; end: number; play(): void };
  type RegionOptions = { id?: string; start: number; end?: number; content?: string; color?: string; drag?: boolean; resize?: boolean; minLength?: number };
  class RegionsPlugin {
    static create(): RegionsPlugin;
    addRegion(options: RegionOptions): Region;
    clearRegions(): void;
    on(event: 'region-updated', listener: (region: Region) => void): () => void;
    on(event: 'region-clicked', listener: (region: Region, event: MouseEvent) => void): () => void;
  }
  export default RegionsPlugin;
}

declare module 'wavesurfer.js/plugins/timeline' {
  class TimelinePlugin { static create(options?: { height?: number }): TimelinePlugin }
  export default TimelinePlugin;
}
