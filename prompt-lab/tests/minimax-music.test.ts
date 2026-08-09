import { describe, expect, it } from 'vitest';
import { defaultMusicPrompt, formatLyricsForMiniMax } from '../src/plugins/lyric-studio/minimax-music';
import type { LyricProject } from '../src/plugins/lyric-studio/types';

const project = {
  id: 'm', title: '夏夜', theme: '告别', style: '华语流行', emotion: '遗憾', language: '中文', bpm: 72, location: '车站', time: '黄昏', story: '', coreImages: [], tags: [], favorite: false, collection: '', status: 'draft', coverColor: '#000', creativePrompt: '', promptHistory: [], promptPriority: 'prompt', scratchpad: '', beatMarks: {}, favoriteLines: [], updatedAt: 0,
  sections: [
    { id: 'v', kind: 'Verse', title: 'Verse 1', lyrics: '雨落在车站\n晚风没有回答', emotion: '', rhyme: 'an', syllables: '8' },
    { id: 'c', kind: 'Chorus', title: 'Chorus', lyrics: '你走以后\n灯还等候', emotion: '', rhyme: 'ou', syllables: '8' },
  ],
} satisfies LyricProject;

describe('MiniMax music integration', () => {
  it('formats structured lyrics with supported tags', () => { const lyrics = formatLyricsForMiniMax(project); expect(lyrics).toContain('[Verse]'); expect(lyrics).toContain('[Chorus]'); expect(lyrics).toContain('你走以后'); });
  it('creates a concise project based music prompt', () => { const prompt = defaultMusicPrompt(project); expect(prompt).toContain('华语流行'); expect(prompt).toContain('72 BPM'); });
});
