import { describe, expect, it } from 'vitest';
import { analyzeLines, countHan, detectRhyme, projectToText, rhymePattern, rhymeSuggestions, scoreProject } from '../src/plugins/lyric-studio/analysis';
import { matchesProject } from '../src/plugins/lyric-studio/project-store';
import type { LyricProject } from '../src/plugins/lyric-studio/types';

const project: LyricProject = { id: '1', title: '夏夜', theme: '告别', style: '流行', emotion: '遗憾', language: '中文', bpm: 72, location: '车站', time: '黄昏', story: '没有说完的告别', coreImages: ['车票', '街灯', '雨'], tags: ['青春'], favorite: true, collection: '夏日 EP', status: 'draft', coverColor: '#7c3aed', updatedAt: 0, sections: [
  { id: 'v', kind: 'Verse', title: 'Verse 1', lyrics: '晚风吹过那片天空\n回忆突然开始失控', emotion: '克制', rhyme: 'ong', syllables: '8-10' },
  { id: 'c', kind: 'Chorus', title: 'Chorus', lyrics: '如果时间能够倒流\n如果时间能够倒流', emotion: '释放', rhyme: 'ou', syllables: '8-10' },
] };

describe('lyric studio analysis', () => {
  it('detects common Chinese rhymes', () => { expect(detectRhyme('我望着天空。')).toBe('ong'); expect(detectRhyme('陪你到以后')).toBe('ou'); });
  it('counts Han characters without punctuation', () => { expect(countHan('晚风，吹过！')).toBe(4); });
  it('scores and exports a structured project', () => { expect(scoreProject(project).overall).toBeGreaterThan(50); expect(projectToText(project)).toContain('[Chorus]'); });
  it('builds rhyme and rhythm analysis', () => { expect(rhymePattern(project.sections[0].lyrics)).toBe('AA'); expect(rhymeSuggestions('ong')).toContain('心动'); expect(analyzeLines('短句\n这一句稍微长一些', 60)[1].durationSeconds).toBeGreaterThan(1); });
  it('searches project metadata', () => { expect(matchesProject(project, '夏日')).toBe(true); expect(matchesProject(project, '摇滚')).toBe(false); });
});
