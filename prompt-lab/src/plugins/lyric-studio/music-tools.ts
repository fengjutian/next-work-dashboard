import Meyda from 'meyda';
import { buildCandidateSegments } from './audio-structure';
import type { AudioAnalysis, AudioFeatureFrame, LrcLine, MelodyNote } from './types';

function extractAudioFeatures(data: Float32Array, sampleRate: number): AudioFeatureFrame[] {
  const frameSize = 4096;
  const hopSize = Math.max(frameSize, Math.round(sampleRate * 0.5));
  Meyda.bufferSize = frameSize;
  const frames: AudioFeatureFrame[] = [];
  for (let offset = 0; offset + frameSize <= data.length; offset += hopSize) {
    const result = Meyda.extract(['rms', 'spectralCentroid', 'chroma', 'mfcc'], data.slice(offset, offset + frameSize));
    if (!result || Array.isArray(result)) continue;
    frames.push({
      time: offset / sampleRate,
      rms: Number(result.rms ?? 0),
      spectralCentroid: Number(result.spectralCentroid ?? 0) * sampleRate / frameSize,
      chroma: Array.from(result.chroma ?? []).map(Number),
      mfcc: Array.from(result.mfcc ?? []).map(Number),
    });
  }
  return frames;
}

export async function analyzeAudioFile(file: File): Promise<{ analysis: AudioAnalysis; buffer: AudioBuffer }> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const windowSize = Math.max(256, Math.floor(buffer.sampleRate * 0.02));
    const peaks: number[] = [];
    for (let offset = 0; offset < data.length; offset += windowSize) {
      let energy = 0;
      for (let i = offset; i < Math.min(data.length, offset + windowSize); i += 1) energy += data[i] * data[i];
      peaks.push(energy / windowSize);
    }
    const threshold = peaks.reduce((sum, value) => sum + value, 0) / Math.max(1, peaks.length) * 1.65;
    const hits = peaks.map((value, index) => value > threshold && value >= (peaks[index - 1] ?? 0) && value >= (peaks[index + 1] ?? 0) ? index : -1).filter((index) => index >= 0);
    const intervals = hits.slice(1).map((hit, index) => (hit - hits[index]) * windowSize / buffer.sampleRate).filter((value) => value > 0.25 && value < 1.5);
    const median = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)] || 0.5;
    let bpm = Math.round(60 / median); while (bpm < 60) bpm *= 2; while (bpm > 180) bpm = Math.round(bpm / 2);
    const waveformBins = 120; const waveform: number[] = []; const binSize = Math.max(1, Math.floor(data.length / waveformBins));
    for (let bin = 0; bin < waveformBins; bin += 1) { let peak = 0; for (let i = bin * binSize; i < Math.min(data.length, (bin + 1) * binSize); i += Math.max(1, Math.floor(binSize / 80))) peak = Math.max(peak, Math.abs(data[i])); waveform.push(Number(peak.toFixed(3))); }
    const pitchNames = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']; const pitchEnergy = new Array(12).fill(0);
    const sampleLimit = Math.min(data.length, buffer.sampleRate * 12); const stride = 8;
    for (let pitch = 0; pitch < 12; pitch += 1) for (let octave = 3; octave <= 5; octave += 1) { const frequency = 440 * 2 ** (((octave + 1) * 12 + pitch - 69) / 12); let real = 0; let imaginary = 0; for (let i = 0; i < sampleLimit; i += stride) { const phase = 2 * Math.PI * frequency * i / buffer.sampleRate; real += data[i] * Math.cos(phase); imaginary -= data[i] * Math.sin(phase); } pitchEnergy[pitch] += Math.hypot(real, imaginary); }
    const key = pitchNames[pitchEnergy.indexOf(Math.max(...pitchEnergy))] || 'C';
    const features = extractAudioFeatures(data, buffer.sampleRate);
    const segments = buildCandidateSegments(features, buffer.duration, bpm);
    return { buffer, analysis: { name: file.name, duration: buffer.duration, bpm, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, key: `${key}（估算）`, waveform, features, segments } };
  } finally { void context.close(); }
}

export function formatLrcTime(seconds: number): string {
  const safe = Math.max(0, seconds); const minutes = Math.floor(safe / 60); const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

export function exportLrc(title: string, lines: LrcLine[]): void {
  const content = [`[ti:${title}]`, ...lines.sort((a, b) => a.time - b.time).map((line) => `[${formatLrcTime(line.time)}]${line.text}`)].join('\n');
  downloadBlob(content, `${safeName(title)}.lrc`, 'text/plain;charset=utf-8');
}

function variableLength(value: number): number[] { const bytes = [value & 0x7f]; while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80); return bytes; }

export function exportMidi(title: string, notes: MelodyNote[], bpm: number): void {
  const division = 480; const track: number[] = [0x00, 0xff, 0x51, 0x03, ...[(60_000_000 / bpm) >> 16 & 255, (60_000_000 / bpm) >> 8 & 255, (60_000_000 / bpm) & 255]];
  for (const note of notes) { const ticks = Math.max(60, Math.round(note.beats * division)); track.push(0x00, 0x90, Math.max(36, Math.min(84, note.pitch)), 90, ...variableLength(ticks), 0x80, Math.max(36, Math.min(84, note.pitch)), 0); }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,division >> 8,division & 255]; const length = track.length;
  const bytes = new Uint8Array([...header,0x4d,0x54,0x72,0x6b,(length >>> 24)&255,(length >>> 16)&255,(length >>> 8)&255,length&255,...track]);
  downloadBlob(bytes, `${safeName(title)}.mid`, 'audio/midi');
}

function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]/g, '-') || 'song'; }
function downloadBlob(content: BlobPart, name: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
