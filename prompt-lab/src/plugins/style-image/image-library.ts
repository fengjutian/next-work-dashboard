import { dbDeleteGeneratedImage, dbListGeneratedImages, dbSaveGeneratedImage } from '@/db';

export interface StoredImage {
  id: string;
  prompt: string;
  style: string;
  provider: string;
  model: string;
  aspectRatio: string;
  mimeType: string;
  size: number;
  createdAt: number;
  image: Blob;
}

export async function saveImage(record: StoredImage): Promise<void> {
  await dbSaveGeneratedImage({ ...record, image: new Uint8Array(await record.image.arrayBuffer()) });
}

export function listImages(): StoredImage[] {
  return dbListGeneratedImages().map((record) => ({ ...record, image: new Blob([record.image], { type: record.mimeType }) }));
}

export async function deleteImage(id: string): Promise<void> {
  await dbDeleteGeneratedImage(id);
}
