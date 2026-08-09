import { dbDeleteGeneratedMusic, dbListGeneratedMusic, dbSaveGeneratedMusic, dbUpdateGeneratedMusic } from '@/db';

export interface StoredMusic {
  id: string;
  projectId: string;
  title: string;
  model: string;
  prompt: string;
  format: 'mp3' | 'wav';
  durationMs?: number;
  sampleRate?: number;
  bitrate?: number;
  size: number;
  favorite: boolean;
  createdAt: number;
  audio: Blob;
}

export async function saveMusic(record: StoredMusic): Promise<void> {
  await dbSaveGeneratedMusic({ ...record, audio: new Uint8Array(await record.audio.arrayBuffer()) });
}

export async function listProjectMusic(projectId: string): Promise<StoredMusic[]> {
  return dbListGeneratedMusic(projectId).map((record) => ({ ...record, audio: new Blob([record.audio], { type: record.format === 'wav' ? 'audio/wav' : 'audio/mpeg' }) }));
}

export async function deleteMusic(id: string): Promise<void> {
  await dbDeleteGeneratedMusic(id);
}

export async function updateMusic(id: string, patch: Partial<Pick<StoredMusic, 'title' | 'favorite'>>): Promise<void> {
  await dbUpdateGeneratedMusic(id, patch);
}
