import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import TimelinePlugin from 'wavesurfer.js/plugins/timeline';
import type { AudioStructureSegment } from './types';

const COLORS: Record<AudioStructureSegment['kind'], string> = {
  Intro: 'rgba(59,130,246,.22)', Verse: 'rgba(139,92,246,.22)', 'Pre-Chorus': 'rgba(245,158,11,.24)',
  Chorus: 'rgba(236,72,153,.24)', Bridge: 'rgba(16,185,129,.24)', Outro: 'rgba(100,116,139,.24)', Unknown: 'rgba(148,163,184,.2)',
};

export const AudioStructureTimeline: React.FC<{
  audioUrl: string;
  segments: AudioStructureSegment[];
  onChange: (segments: AudioStructureSegment[]) => void;
}> = ({ audioUrl, segments, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer>();
  const regionsRef = useRef<RegionsPlugin>();
  const segmentsRef = useRef(segments);
  const syncingRef = useRef(false);
  segmentsRef.current = segments;

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;
    const regions = RegionsPlugin.create();
    const wave = WaveSurfer.create({
      container: containerRef.current, url: audioUrl, height: 132, normalize: true,
      waveColor: '#a78bfa', progressColor: '#6d28d9', cursorColor: '#111827',
      plugins: [regions, TimelinePlugin.create({ height: 18 })],
    });
    waveRef.current = wave; regionsRef.current = regions;
    regions.on('region-updated', (region) => {
      if (syncingRef.current) return;
      onChange(segmentsRef.current.map((segment) => segment.id === region.id ? { ...segment, start: region.start, end: region.end } : segment));
    });
    regions.on('region-clicked', (region, event) => { event.stopPropagation(); region.play(); });
    return () => { wave.destroy(); waveRef.current = undefined; regionsRef.current = undefined; };
  }, [audioUrl, onChange]);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    syncingRef.current = true;
    regions.clearRegions();
    segments.forEach((segment) => regions.addRegion({ id: segment.id, start: segment.start, end: segment.end, content: segment.kind, color: COLORS[segment.kind], drag: true, resize: true, minLength: 1 }));
    syncingRef.current = false;
  }, [segments]);

  return <div className="overflow-hidden rounded-xl border bg-card p-2"><div ref={containerRef} /><p className="px-2 pb-1 pt-2 text-[10px] text-muted-foreground">点击段落试听；拖动色块或左右边缘调整时间。</p></div>;
};
