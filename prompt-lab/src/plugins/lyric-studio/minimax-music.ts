import type { LyricProject, LyricSection } from './types';

export interface MiniMaxMusicSettings {
  apiKey: string;
  model: 'music-3.0' | 'music-3.0-free' | 'music-2.6' | 'music-2.6-free';
  prompt: string;
  format: 'mp3' | 'wav';
  sampleRate: 32000 | 44100;
  bitrate: 128000 | 256000;
}

export interface MiniMaxMusicResult {
  audioUrl: string;
  audioBlob: Blob;
  durationMs?: number;
  sampleRate?: number;
  bitrate?: number;
  size?: number;
  traceId?: string;
}

const SECTION_TAGS: Record<LyricSection['kind'], string> = {
  Intro: 'Intro', Verse: 'Verse', 'Pre-Chorus': 'Pre Chorus', Chorus: 'Chorus', Bridge: 'Bridge', Outro: 'Outro',
};

export function formatLyricsForMiniMax(project: LyricProject): string {
  return project.sections.filter((section) => section.lyrics.trim()).map((section) => `[${SECTION_TAGS[section.kind]}]\n${section.lyrics.trim()}`).join('\n\n').slice(0, 3500);
}

export function defaultMusicPrompt(project: LyricProject): string {
  return [project.style, project.emotion, `${project.bpm} BPM`, project.location, project.time, '华语演唱', '清晰人声', '完整编曲'].filter(Boolean).join(', ').slice(0, 2000);
}

function hexToBlob(hex: string, format: string): Blob {
  const clean = hex.replace(/^0x/, ''); const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return new Blob([bytes], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
}

export async function generateMiniMaxMusic(settings: MiniMaxMusicSettings, project: LyricProject, signal?: AbortSignal): Promise<MiniMaxMusicResult> {
  const lyrics = formatLyricsForMiniMax(project);
  if (!settings.apiKey.trim()) throw new Error('请填写 MiniMax API Key');
  if (!lyrics) throw new Error('当前项目没有可生成歌曲的歌词');
  const response = await fetch('https://api.minimaxi.com/v1/music_generation', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model, prompt: settings.prompt.trim(), lyrics, output_format: 'hex', audio_setting: { sample_rate: settings.sampleRate, bitrate: settings.bitrate, format: settings.format }, aigc_watermark: false, lyrics_optimizer: false }),
  });
  const result = await response.json() as { data?: { audio?: string; status?: number }; trace_id?: string; extra_info?: { music_duration?: number; music_sample_rate?: number; bitrate?: number; music_size?: number }; base_resp?: { status_code?: number; status_msg?: string } };
  if (!response.ok || result.base_resp?.status_code) throw new Error(result.base_resp?.status_msg || `MiniMax 请求失败（HTTP ${response.status}）`);
  const audio = result.data?.audio;
  if (!audio) throw new Error('MiniMax 没有返回音频，请检查账户额度、模型权限和歌词长度');
  const audioBlob = /^https?:\/\//.test(audio) ? await fetch(audio, { signal }).then((value) => { if (!value.ok) throw new Error('无法下载 MiniMax 临时音频'); return value.blob(); }) : hexToBlob(audio, settings.format);
  return { audioUrl: URL.createObjectURL(audioBlob), audioBlob, durationMs: result.extra_info?.music_duration, sampleRate: result.extra_info?.music_sample_rate, bitrate: result.extra_info?.bitrate, size: result.extra_info?.music_size ?? audioBlob.size, traceId: result.trace_id };
}
