import { describe, expect, it } from 'vitest';
import { parseLitterboxUploadUrl } from '../../src/main/video-generation/reference-upload';

describe('Litterbox upload response', () => {
  it('accepts the file host returned by successful uploads', () => {
    expect(parseLitterboxUploadUrl('https://litter.catbox.moe/60bnyb.jpg\n'))
      .toBe('https://litter.catbox.moe/60bnyb.jpg');
  });

  it('keeps compatibility with the service host and rejects unrelated content', () => {
    expect(parseLitterboxUploadUrl('https://litterbox.catbox.moe/example.png'))
      .toBe('https://litterbox.catbox.moe/example.png');
    expect(parseLitterboxUploadUrl('Internal Server Error')).toBeNull();
    expect(parseLitterboxUploadUrl('https://example.com/file.jpg')).toBeNull();
  });
});
