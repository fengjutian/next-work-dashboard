import { countHan } from './analysis';
import type { LyricProject, LyricSection } from './types';

export interface TimelineSection {
  section: LyricSection;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  beats: number;
  capacity: number;
  used: number;
}

export interface BeatCell { text: string; beat: number; subdivision: number; }
export interface ClicheIssue { sectionId: string; sectionTitle: string; line: string; category: '金句候选' | '陈词滥调' | '抽象表达' | '意象堆砌' | '过度解释'; severity: 'info' | 'warning'; suggestion: string; }

export type BeatMark = 'accent' | 'hold' | 'rest' | 'pickup';
export type BeatMarks = Record<string, BeatMark>;

const defaultBars = (section: LyricSection) => section.kind === 'Intro' || section.kind === 'Outro' ? 4 : section.kind === 'Chorus' ? 8 : 8;

export function buildTimeline(project: LyricProject): TimelineSection[] {
  let cursor = 0;
  return project.sections.map((section) => {
    const lines = section.lyrics.split(/\r?\n/).filter((line) => line.trim()).length;
    const bars = section.bars ?? Math.max(defaultBars(section), Math.ceil(lines / 2) * 4);
    const beats = bars * 4;
    const durationSeconds = Number((beats * 60 / Math.max(40, project.bpm)).toFixed(1));
    const item = { section, startSeconds: cursor, durationSeconds, endSeconds: Number((cursor + durationSeconds).toFixed(1)), beats, capacity: beats * 2, used: countHan(section.lyrics) };
    cursor = item.endSeconds;
    return item;
  });
}

export function formatClock(seconds: number): string {
  const minute = Math.floor(seconds / 60); const rest = Math.round(seconds % 60);
  return `${String(minute).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function lineToBeatGrid(line: string, subdivisions = 2): BeatCell[] {
  return Array.from(line.replace(/\s/g, '')).map((text, index) => ({ text, beat: Math.floor(index / subdivisions) + 1, subdivision: index % subdivisions }));
}

export function lineBeatMarkKey(sectionId: string, lineIndex: number, charIndex: number): string {
  return `${sectionId}:${lineIndex}:${charIndex}`;
}

/**
 * 自动为一段歌词建议节拍标记，只返回未在 existingMarks 中存在的 key。
 * - 段落最后一行最后一个字：`accent`（line-final 重音）
 * - 4/4 拍第 1、第 3 拍的第一个字：`accent`（强拍重音）
 * - 段首第一行第一个字：`pickup`（如果它不在强拍位置上）
 * - 包含逗号/句号/空格前的字符：`hold`（拖音）
 */
export function suggestBeatMarks(
  section: LyricSection,
  bpm: number,
  existingMarks: BeatMarks = {},
  options: { subdivisions?: number; targetBars?: number } = {},
): BeatMarks {
  const totalBeats = Math.max(1, Math.round((options.targetBars ?? defaultBars(section)) * 4));

  const lines = section.lyrics.split(/\r?\n/);
  const suggestions: BeatMarks = {};
  const beatsPerLine = totalBeats / Math.max(1, lines.filter((line) => line.trim()).length || 1);

  lines.forEach((rawLine, lineIndex) => {
    const chars = Array.from(rawLine.replace(/\s/g, ''));
    if (!chars.length) return;
    const lineStartBeat = lineIndex * beatsPerLine;
    chars.forEach((char, charIndex) => {
      const key = lineBeatMarkKey(section.id, lineIndex, charIndex);
      if (existingMarks[key]) return;
      const beat = lineStartBeat + (charIndex / Math.max(1, chars.length)) * beatsPerLine;
      const beatPosition = Math.round(beat) % 4 || 4;
      const isLastChar = charIndex === chars.length - 1;
      const isFirstLineFirstChar = lineIndex === 0 && charIndex === 0;
      const isPrecedingPunct = char === '，' || char === '。' || char === ',' || char === '.' || char === '、' || char === '；';
      if (isLastChar) suggestions[key] = 'accent';
      else if (isFirstLineFirstChar && beatPosition !== 1) suggestions[key] = 'pickup';
      else if (beatPosition === 1 || beatPosition === 3) suggestions[key] = 'accent';
      else if (isPrecedingPunct) suggestions[key] = 'hold';
      else if (charIndex === 0) suggestions[key] = 'pickup';
      // else: leave un-marked; user can fill in
    });
  });
  return suggestions;
}

const CLICHES = ['撕心裂肺', '爱到永远', '直到世界尽头', '没有你的世界', '心碎成片', '眼泪成诗', '命中注定', '无法呼吸'];
const ABSTRACT = ['爱情', '思念', '孤独', '悲伤', '幸福', '遗憾', '难过', '痛苦'];
const IMAGES = ['月光', '烟雨', '红尘', '长亭', '孤舟', '落花', '琴', '剑', '酒', '江南', '纸伞', '霓虹', '车站', '街灯'];

export function inspectLyrics(project: LyricProject): ClicheIssue[] {
  const issues: ClicheIssue[] = [];
  project.sections.forEach((section) => section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const cliché = CLICHES.find((word) => line.includes(word));
    if (cliché) issues.push({ sectionId: section.id, sectionTitle: section.title, line, category: '陈词滥调', severity: 'warning', suggestion: `“${cliché}”较常见，尝试用具体物件和动作替代。` });
    const abstractCount = ABSTRACT.filter((word) => line.includes(word)).length;
    if (abstractCount >= 2) issues.push({ sectionId: section.id, sectionTitle: section.title, line, category: '抽象表达', severity: 'warning', suggestion: '抽象情绪词偏多，让场景、物件或动作承担情绪。' });
    const imageCount = IMAGES.filter((word) => line.includes(word)).length;
    if (imageCount >= 3) issues.push({ sectionId: section.id, sectionTitle: section.title, line, category: '意象堆砌', severity: 'warning', suggestion: '同一句意象过密，保留一个主意象并让它自然生长。' });
    if (/因为.*所以|其实我只是|我想说的是/.test(line)) issues.push({ sectionId: section.id, sectionTitle: section.title, line, category: '过度解释', severity: 'warning', suggestion: '删去解释性连接，让听众从前后画面自行理解。' });
    if (countHan(line) >= 8 && countHan(line) <= 14 && /[却还把留等忘回未]/.test(line) && !ABSTRACT.some((word) => line.includes(word))) issues.push({ sectionId: section.id, sectionTitle: section.title, line, category: '金句候选', severity: 'info', suggestion: '具备动作、留白和传播长度，可考虑放入副歌或歌名。' });
  }));
  return issues;
}
