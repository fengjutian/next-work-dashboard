/**
 * 十二星座视角插件 — 复制 / 导出
 *
 * 需求 §6.8：复制内容必须包含原问题、生成时间和"AI 生成的娱乐化多视角内容"说明。
 */

import type { ZodiacPerspective, ZodiacRun, ZodiacSynthesis } from './zodiac-types';
import { ZODIAC_META } from './zodiac-data';

const SAFETY_NOTE = '> 本内容由 AI 生成，属于娱乐化的多视角启发，不构成专业意见。';

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function perspectiveSection(p: ZodiacPerspective): string {
  const meta = ZODIAC_META[p.sign];
  const lines: string[] = [];
  lines.push(`## ${meta.glyph} ${meta.name} · ${meta.keywords.join('、')}`);
  lines.push('');
  lines.push(`**如何理解**：${p.interpretation}`);
  lines.push('');
  lines.push('**最关注什么**');
  for (const item of p.focus) lines.push(`- ${item}`);
  lines.push('');
  lines.push('**建议怎么做**');
  for (const item of p.advice) lines.push(`- ${item}`);
  if (p.caution) {
    lines.push('');
    lines.push(`**注意**：${p.caution}`);
  }
  return lines.join('\n');
}

function synthesisSection(synthesis: ZodiacSynthesis): string {
  const lines: string[] = [];
  lines.push('# 圆桌纪要');
  lines.push('');
  lines.push('## 共识');
  for (const item of synthesis.consensus) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 主要分歧');
  for (const d of synthesis.disagreements) {
    lines.push(`- **${d.topic}**`);
    for (const p of d.positions) lines.push(`    - ${p}`);
  }
  lines.push('');
  lines.push('## 容易忽略的盲点');
  for (const item of synthesis.blindSpots) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 综合行动建议');
  for (const item of synthesis.nextSteps) lines.push(`- ${item}`);
  return lines.join('\n');
}

export function buildSinglePerspectiveMarkdown(run: ZodiacRun, perspective: ZodiacPerspective): string {
  const meta = ZODIAC_META[perspective.sign];
  const head = [
    `# ${meta.glyph} ${meta.name} · 十二星座视角`,
    '',
    `- 原问题：${run.question}`,
    `- 生成时间：${formatTimestamp(run.createdAt)}`,
    `- 选项：场景 ${run.options.scene} / 篇幅 ${run.options.length} / 语气 ${run.options.tone}`,
  ].join('\n');
  return [head, '', perspectiveSection(perspective), '', SAFETY_NOTE].join('\n');
}

export function buildAllPerspectivesMarkdown(run: ZodiacRun): string {
  const head = [
    `# 十二星座视角 · 全部 ${run.perspectives.length} 个视角`,
    '',
    `- 原问题：${run.question}`,
    `- 生成时间：${formatTimestamp(run.createdAt)}`,
    `- 选项：场景 ${run.options.scene} / 篇幅 ${run.options.length} / 语气 ${run.options.tone}${run.partial ? ' / 含缺失项' : ''}`,
  ].join('\n');
  const sections = run.perspectives.map(perspectiveSection).join('\n\n');
  return [head, '', sections, '', SAFETY_NOTE].join('\n');
}

export function buildSynthesisMarkdown(run: ZodiacRun): string {
  if (!run.synthesis) return `${buildAllPerspectivesMarkdown(run)}\n\n（本次未生成汇总）`;
  const head = [
    `# 十二星座视角 · 圆桌纪要`,
    '',
    `- 原问题：${run.question}`,
    `- 生成时间：${formatTimestamp(run.createdAt)}`,
  ].join('\n');
  return [head, '', synthesisSection(run.synthesis), '', SAFETY_NOTE].join('\n');
}

/** 仅供 UI toast 反馈；持久化错误由调用方处理 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  // Fallback：textarea + execCommand
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
