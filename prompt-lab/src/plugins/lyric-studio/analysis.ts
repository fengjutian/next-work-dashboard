import type { LyricLineAnalysis, LyricProject, LyricScore, LyricSection } from './types';

const RHYMES: Array<[string, RegExp]> = [
  ['ang', /(昂|帮|旁|忙|方|房|香|想|响|乡|光|望|忘|伤|长|浪|上|场|墙|霜|凉|黄)$/],
  ['eng', /(灯|等|冷|声|生|城|程|更|风|梦|疼|仍|曾|层)$/],
  ['ing', /(英|冰|明|星|醒|静|情|晴|影|景|听|停|心|音|名|铃|萤|宁)$/],
  ['ai', /(爱|来|海|开|白|在|怀|台|外|败|待|街|鞋|拍|埋)$/],
  ['ei', /(泪|飞|归|灰|背|北|美|谁|醉|碎|黑|退)$/],
  ['ao', /(岛|桥|抱|到|少|角|潮|晓|跑|老|草|帽)$/],
  ['ou', /(欧|楼|流|留|秋|愁|走|手|口|后|候|透|舟|旧|酒)$/],
  ['an', /(安|岸|晚|暖|散|看|难|然|站|伞|慢|盼)$/],
  ['ian', /(天|年|边|前|见|间|脸|线|片|远|烟|念)$/],
  ['en', /(门|尘|痕|人|身|深|真|晨|温|吻|等|冷)$/],
  ['ong', /(空|风|梦|中|痛|懂|动|拥|红|重|钟|控|虹|冬)$/],
  ['i', /(你|里|雨|忆|离|期|季|息|纸|字|事|日)$/],
  ['u', /(路|书|树|雾|哭|住|故|处|渡|幕|孤)$/],
  ['ie', /(夜|街|写|别|谢|页|鞋|界|却|月|雪)$/],
];

export function detectRhyme(line: string): string {
  const clean = line.trim().replace(/[，。！？、,.!?;；:："'”’）)】\]]+$/, '');
  return RHYMES.find(([, pattern]) => pattern.test(clean))?.[0] ?? (clean ? '未知' : '—');
}

export function countHan(line: string): number {
  return (line.match(/[\u3400-\u9fff]/g) ?? []).length;
}

const TONE_GROUPS: Array<[string, string]> = [
  ['1', '一衣依音英星风空中东春秋灯光天边江乡'],
  ['2', '人时年情明晴红黄长来回流愁离桥城门'],
  ['3', '你我雨晚远想等冷走手影醒海里'],
  ['4', '爱梦痛泪夜月路去后旧站信忘望静'],
];

function analyzeTone(line: string): { pattern: string; issues: string[] } {
  const tones = Array.from(line).filter((char) => /[\u3400-\u9fff]/.test(char)).map((char) => TONE_GROUPS.find(([, chars]) => chars.includes(char))?.[0] ?? '?');
  const pattern = tones.join(''); const issues: string[] = [];
  if (/333/.test(pattern)) issues.push('连续上声，演唱时可能拗口');
  if (/4444/.test(pattern)) issues.push('连续去声较密，注意旋律下行压力');
  if ((pattern.match(/\?/g) ?? []).length > tones.length / 2) issues.push('部分字声调待人工确认');
  return { pattern: pattern || '—', issues };
}

const RHYME_WORDS: Record<string, string[]> = {
  an: ['晚', '岸', '伞', '站', '看', '暖', '散', '慢', '远', '边'],
  ang: ['光', '巷', '窗', '霜', '望', '忘', '伤', '长', '浪', '场'],
  en: ['门', '尘', '痕', '人', '认真', '体温', '清晨', '转身'],
  eng: ['灯', '风声', '旅程', '永恒', '等', '冷', '一生', '发生'],
  ou: ['走', '手', '以后', '停留', '路口', '回头', '等候', '宇宙'],
  ao: ['岛', '桥', '拥抱', '迟到', '年少', '街角', '浪潮', '知道'],
  i: ['你', '雨', '回忆', '距离', '玻璃', '消息', '四季', '日期'],
  ing: ['星', '醒', '听', '安静', '风景', '曾经', '电影', '姓名'],
  ong: ['空', '风', '梦', '失控', '心动', '霓虹', '时钟', '相拥'],
};

export function rhymeSuggestions(rhyme: string): string[] {
  return RHYME_WORDS[rhyme.toLowerCase()] ?? [];
}

export function analyzeLines(lyrics: string, bpm: number): LyricLineAnalysis[] {
  const lines = lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const counts = lines.map(countHan);
  const average = counts.reduce((sum, value) => sum + value, 0) / Math.max(1, counts.length);
  const secondsPerBeat = 60 / Math.max(40, bpm);
  return lines.map((line, index) => {
    const hanCount = counts[index];
    const durationSeconds = Number((Math.max(1, hanCount / 2) * secondsPerBeat).toFixed(1));
    const tone = analyzeTone(line);
    return { line, hanCount, rhyme: detectRhyme(line), durationSeconds, breathing: hanCount >= 12 ? '建议在中点加入呼吸' : hanCount >= 8 ? '自然换气' : '可连唱', lengthKind: hanCount <= 5 ? 'short' : hanCount <= 10 ? 'medium' : 'long', deviation: Number((hanCount - average).toFixed(1)), tonePattern: tone.pattern, singabilityIssues: tone.issues };
  });
}

export function rhymePattern(lyrics: string): string {
  const rhymes = lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(detectRhyme);
  const labels = new Map<string, string>();
  return rhymes.map((rhyme) => { if (!labels.has(rhyme)) labels.set(rhyme, String.fromCharCode(65 + labels.size)); return labels.get(rhyme); }).join('');
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
  return [`# ${project.title}`, `主题：${project.theme}`, `风格：${project.style} · ${project.bpm} BPM`, `场景：${project.time} · ${project.location}`, `核心意象：${project.coreImages.join('、')}`, `故事：${project.story}`, '', ...project.sections.flatMap((section) => [`[${section.title}]`, section.lyrics, ''])].join('\n');
}

// ---------------------------------------------------------------------------
// Quality gate for AI-generated candidates
// ---------------------------------------------------------------------------

export type QualityIssueCategory = 'rhythm' | 'rhyme' | 'cliche' | 'length' | 'singability' | 'pinyin';

export interface QualityIssue {
  sectionId: string;
  sectionTitle: string;
  line: string;
  lineIndex: number;
  category: QualityIssueCategory;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface QualityReport {
  overall: number;
  rhythm: number;
  rhyme: number;
  length: number;
  flaggedLines: number;
  totalLines: number;
  issues: QualityIssue[];
  summary: string[];
}

const GATE_CLICHES = [
  '撕心裂肺', '爱到永远', '直到世界尽头', '没有你的世界', '心碎成片',
  '眼泪成诗', '命中注定', '无法呼吸', '你那么美', '爱你到老', '刻骨铭心',
  '生死相依', '天长地久', '海枯石烂', '不离不弃', '独自承受',
];
const GATE_ABSTRACT = ['爱情', '思念', '孤独', '悲伤', '幸福', '遗憾', '难过', '痛苦', '心痛', '永远', '回忆'];
const SINGABILITY_TRIGRAMS = ['的的的', '了了了', '是是是', '啊啊阿'];

function percentage(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

export function gateQuality(sections: LyricSection[], bpm: number): QualityReport {
  const issues: QualityIssue[] = [];
  const allLines: Array<{ section: LyricSection; line: string; lineIndex: number; rhyme: string; han: number }> = [];
  let totalChars = 0;
  sections.forEach((section) => {
    const nonEmpty = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    nonEmpty.forEach((line, lineIndex) => {
      allLines.push({ section, line, lineIndex, rhyme: detectRhyme(line), han: countHan(line) });
      totalChars += countHan(line);
    });
  });

  if (!allLines.length) {
    return { overall: 0, rhythm: 0, rhyme: 0, length: 0, flaggedLines: 0, totalLines: 0, issues: [], summary: ['还没有歌词内容，先生成或写入一些文本。'] };
  }

  // --- rhythm: per-section length consistency ---
  sections.forEach((section) => {
    const lines = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const counts = lines.map(countHan);
    const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    const max = Math.max(...counts); const min = Math.min(...counts);
    if (max - min >= 6) {
      lines.forEach((line, lineIndex) => {
        const deviation = counts[lineIndex] - mean;
        if (Math.abs(deviation) >= 4) {
          issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'rhythm', severity: 'warning', message: `与本段平均字数 (${mean.toFixed(1)}) 相差 ${Math.abs(deviation).toFixed(1)} 字，唱起来节奏会跳。` });
        }
      });
    }
  });

  // --- rhyme: AABB / AAAA pattern + per-section primary rhyme ---
  sections.forEach((section) => {
    const lines = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const rhymes = lines.map(detectRhyme).filter((value) => value !== '—' && value !== '未知');
    if (rhymes.length < 2) return;
    const counts = rhymes.reduce<Record<string, number>>((map, value) => ({ ...map, [value]: (map[value] ?? 0) + 1 }), {});
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / rhymes.length < 0.4) {
      issues.push({ sectionId: section.id, sectionTitle: section.title, line: lines[0], lineIndex: 0, category: 'rhyme', severity: 'warning', message: `本段主韵较分散（最常用的“${top[0]}”只占 ${Math.round(top[1] / rhymes.length * 100)}%），建议在段落设置里锁定一个韵脚。` });
    }
    if (section.rhyme && section.rhyme !== '自由' && !rhymes.includes(section.rhyme.toLowerCase())) {
      issues.push({ sectionId: section.id, sectionTitle: section.title, line: lines[lines.length - 1], lineIndex: lines.length - 1, category: 'rhyme', severity: 'info', message: `本段设置了主韵“${section.rhyme}”，但歌词中没检测到匹配。` });
    }
    // 连续 3 行同韵 (AAAA) 在主歌里通常需要变化
    for (let index = 0; index < rhymes.length - 2; index += 1) {
      if (rhymes[index] === rhymes[index + 1] && rhymes[index + 1] === rhymes[index + 2] && section.kind === 'Verse') {
        const originalLines = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const matchedLines = originalLines.filter((line) => detectRhyme(line) === rhymes[index]);
        const lineIndex = originalLines.findIndex((line) => line === matchedLines[0]);
        if (lineIndex >= 0) issues.push({ sectionId: section.id, sectionTitle: section.title, line: matchedLines[0], lineIndex, category: 'rhyme', severity: 'info', message: '主歌连续三行同韵，听感可能单调；可考虑在第三句换韵。' });
        break;
      }
    }
  });

  // --- length: per-line overlong / empty Chorus ---
  sections.forEach((section) => {
    if (section.kind === 'Chorus') {
      const lines = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const empty = lines.length === 0;
      if (empty) issues.push({ sectionId: section.id, sectionTitle: section.title, line: '', lineIndex: 0, category: 'length', severity: 'critical', message: '副歌不能为空，否则没有记忆点。' });
      else {
        const repeats = lines.filter((line, index) => lines.indexOf(line) !== index);
        if (!repeats.length && lines.length >= 4) {
          issues.push({ sectionId: section.id, sectionTitle: section.title, line: lines[0], lineIndex: 0, category: 'length', severity: 'info', message: '副歌里没有重复句，听众没有 hook 可以抓住。' });
        }
      }
    }
    const nonEmpty = section.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    nonEmpty.forEach((line, lineIndex) => {
      const han = countHan(line);
      if (han > 18) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'length', severity: 'warning', message: `单行 ${han} 字偏长，演唱容易换气困难。` });
      if (han < 3) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'length', severity: 'info', message: '单行字数太少，可能撑不起一个乐句。' });
    });
  });

  // --- cliché + abstract + singability ---
  allLines.forEach(({ section, line, lineIndex }) => {
    const cliche = GATE_CLICHES.find((word) => line.includes(word));
    if (cliche) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'cliche', severity: 'warning', message: `“${cliche}”是常见套话，试着用具象物件或动作替代。` });
    const abstractCount = GATE_ABSTRACT.filter((word) => line.includes(word)).length;
    if (abstractCount >= 2) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'cliche', severity: 'warning', message: '同一行里出现多个抽象情绪词，让场景/物件/动作承担情绪。' });
    const singability = SINGABILITY_TRIGRAMS.find((tri) => line.includes(tri));
    if (singability) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'singability', severity: 'info', message: `“${singability}”连续同字，演唱时会卡顿。` });
    if (/[a-zA-Z]/.test(line) && countHan(line) > 0) issues.push({ sectionId: section.id, sectionTitle: section.title, line, lineIndex, category: 'pinyin', severity: 'info', message: '中英混排可能影响押韵计算和演唱。' });
  });

  // --- scoring ---
  const rhythmIssues = issues.filter((issue) => issue.category === 'rhythm').length;
  const rhymeIssues = issues.filter((issue) => issue.category === 'rhyme').length;
  const clicheIssues = issues.filter((issue) => issue.category === 'cliche').length;
  const lengthIssues = issues.filter((issue) => issue.category === 'length').length;
  const rhythm = percentage(96 - rhythmIssues * 8);
  const rhyme = percentage(92 - rhymeIssues * 10);
  const length = percentage(90 - lengthIssues * 6 - clicheIssues * 4);
  const overall = percentage((rhythm + rhyme + length) / 3);

  // --- summary: top 3 actionable notes ---
  const summary: string[] = [];
  if (clicheIssues > 0) summary.push(`检测到 ${clicheIssues} 处常见套话或抽象词，建议换成具象动作或物件。`);
  if (rhythmIssues > 0) summary.push(`${rhythmIssues} 行与所在段落的平均字数差距较大，节奏会跳。`);
  if (rhymeIssues > 0) summary.push('有段落主韵较分散或与目标韵脚不一致，可以锁定一个韵脚后重写。');
  if (lengthIssues > 0) summary.push(`存在 ${lengthIssues} 行长度异常（过长难唱或过短缺乐句）。`);
  if (!summary.length) summary.push(`歌词整体稳定（${overall} 分），可以继续打磨细节或直接进入编排。`);

  const flaggedLines = new Set(issues.map((issue) => `${issue.sectionId}:${issue.lineIndex}`)).size;
  return { overall, rhythm, rhyme, length, flaggedLines, totalLines: allLines.length, issues, summary: summary.slice(0, 3) };
}
