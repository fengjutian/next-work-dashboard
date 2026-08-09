import type { LyricProject, LyricScore } from './types';

const RHYMES: Array<[string, RegExp]> = [
  ['ang', /(昂|帮|旁|忙|方|房|香|想|响|乡|光|望|忘|伤|长|浪|上)$/],
  ['ing', /(英|冰|明|星|醒|静|情|晴|影|景|听|停|心|音)$/],
  ['ai', /(爱|来|海|开|白|在|怀|台|外|败|待)$/],
  ['ou', /(欧|楼|流|留|秋|愁|走|手|口|后|候|透)$/],
  ['an', /(安|岸|晚|暖|散|看|难|然|天|年|边|前)$/],
  ['ong', /(空|风|梦|中|痛|懂|动|拥|红|重|钟)$/],
];

export function detectRhyme(line: string): string {
  const clean = line.trim().replace(/[，。！？、,.!?;；:："'”’）)】\]]+$/, '');
  return RHYMES.find(([, pattern]) => pattern.test(clean))?.[0] ?? (clean.slice(-1) || '—');
}

export function countHan(line: string): number {
  return (line.match(/[\u3400-\u9fff]/g) ?? []).length;
}

export function scoreProject(project: LyricProject): LyricScore {
  const lines = project.sections.flatMap((section) => section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  if (!lines.length) return { overall: 0, rhythm: 0, emotion: 0, hook: 0, rhyme: 0, notes: ['先写下几句歌词，评分才有意义。'] };
  const lengths = lines.map(countHan).filter(Boolean);
  const mean = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length);
  const variance = lengths.reduce((sum, value) => sum + Math.abs(value - mean), 0) / Math.max(1, lengths.length);
  const rhythm = Math.round(Math.max(35, 96 - variance * 11));
  const rhymes = lines.map(detectRhyme);
  const rhymeCounts = rhymes.reduce<Record<string, number>>((map, rhyme) => ({ ...map, [rhyme]: (map[rhyme] ?? 0) + 1 }), {});
  const rhyme = Math.round(40 + 60 * Math.max(...Object.values(rhymeCounts)) / lines.length);
  const chorusLines = project.sections.filter((section) => section.kind === 'Chorus').flatMap((section) => section.lyrics.split(/\r?\n/).filter(Boolean));
  const repeated = chorusLines.filter((line, index) => chorusLines.indexOf(line) !== index).length;
  const hook = Math.min(96, 55 + chorusLines.length * 4 + repeated * 8);
  const emotionalWords = ['爱', '想', '痛', '梦', '泪', '心', '孤独', '遗憾', '温柔', '自由', '燃烧'];
  const emotionalHits = emotionalWords.filter((word) => lines.some((line) => line.includes(word))).length;
  const emotion = Math.min(96, 55 + emotionalHits * 6 + (project.emotion.trim() ? 8 : 0));
  const notes: string[] = [];
  if (rhythm < 75) notes.push('句长波动较大，试着让同一段的字数更接近。');
  if (rhyme < 72) notes.push('韵脚较分散，可在段落设置里锁定一个主韵。');
  if (!chorusLines.length) notes.push('缺少副歌；加入一句可重复的核心表达会更容易被记住。');
  else if (hook < 75) notes.push('副歌已有雏形，再重复或变奏一句核心 Hook。');
  if (!notes.length) notes.push('结构和韵律已经稳定，可以开始配旋律验证重音。');
  return { overall: Math.round((rhythm + rhyme + hook + emotion) / 4), rhythm, emotion, hook, rhyme, notes };
}

export function projectToText(project: LyricProject): string {
  return [`# ${project.title}`, `主题：${project.theme}`, `风格：${project.style} · ${project.bpm} BPM`, '', ...project.sections.flatMap((section) => [`[${section.title}]`, section.lyrics, ''])].join('\n');
}
