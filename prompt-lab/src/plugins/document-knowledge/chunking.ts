import type { DocumentChunk, ParsedDocument } from './types';

export interface ChunkOptions { maxChars?: number; overlapChars?: number }

export function chunkDocument(document: ParsedDocument, options: ChunkOptions = {}): Omit<DocumentChunk, 'vector'>[] {
  const maxChars = Math.max(200, options.maxChars ?? 900);
  const overlapChars = Math.min(Math.max(0, options.overlapChars ?? 120), Math.floor(maxChars / 2));
  return document.sections.flatMap((section) => {
    const text = section.content.trim();
    if (!text) return [];
    const chunks: Omit<DocumentChunk, 'vector'>[] = [];
    let start = 0;
    let index = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf('. ', end));
        if (boundary > start + maxChars * 0.55) end = boundary + 1;
      }
      const content = text.slice(start, end).trim();
      if (content) chunks.push({
        id: `${document.id}:${section.id}:${index}`,
        documentId: document.id,
        documentName: document.name,
        sectionId: section.id,
        sectionTitle: section.title,
        page: section.page,
        content,
      });
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlapChars);
      index += 1;
    }
    return chunks;
  });
}
