import fs from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { SyncTargetInput } from './sync-service';

interface StoredTarget { id: string; kind: SyncTargetInput['kind']; encryptedConfig: string; updatedAt: number }

export class SyncTargetStore {
  private filePath = path.join(app.getPath('userData'), 'work-browser', 'sync-targets.json');

  async list(): Promise<Array<{ id: string; kind: SyncTargetInput['kind']; updatedAt: number }>> {
    return (await this.read()).map(({ id, kind, updatedAt }) => ({ id, kind, updatedAt }));
  }

  async get(id: string): Promise<SyncTargetInput | null> {
    const target = (await this.read()).find((item) => item.id === id);
    if (!target) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const config = JSON.parse(safeStorage.decryptString(Buffer.from(target.encryptedConfig, 'base64'))) as Record<string, string>;
    return { id: target.id, kind: target.kind, config };
  }

  async save(target: SyncTargetInput): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const records = await this.read();
    const record: StoredTarget = {
      id: target.id,
      kind: target.kind,
      encryptedConfig: safeStorage.encryptString(JSON.stringify(target.config)).toString('base64'),
      updatedAt: Date.now(),
    };
    const next = [...records.filter((item) => item.id !== target.id), record];
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }

  async remove(id: string): Promise<void> {
    const next = (await this.read()).filter((item) => item.id !== id);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  private async read(): Promise<StoredTarget[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed as StoredTarget[] : [];
    } catch { return []; }
  }
}
