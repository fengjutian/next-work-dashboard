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

/** One-time compatibility migration from the earlier IndexedDB implementation. */
export async function migrateLegacyMusicLibrary(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const records = await new Promise<StoredMusic[]>((resolve) => {
    const request = indexedDB.open('nwd-lyric-studio', 1);
    request.onerror = () => resolve([]);
    request.onupgradeneeded = () => { request.transaction?.abort(); resolve([]); };
    request.onsuccess = () => { const database = request.result; if (!database.objectStoreNames.contains('generated-music')) { database.close(); resolve([]); return; } const query = database.transaction('generated-music').objectStore('generated-music').getAll(); query.onsuccess = () => { database.close(); resolve(query.result as StoredMusic[]); }; query.onerror = () => { database.close(); resolve([]); }; };
  });
  if (!records.length) return 0;
  const existing = new Set(dbListGeneratedMusic('').map((item) => item.id));
  let migrated = 0;
  for (const record of records) { if (existing.has(record.id)) continue; await saveMusic(record); migrated += 1; }
  if (migrated === records.length) indexedDB.deleteDatabase('nwd-lyric-studio');
  return migrated;
}
