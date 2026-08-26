/**
 * WeRead markdown export — pure formatting helpers.
 */

import type { JsonObject } from './types';

export interface WereadExportBook {
  bookId: string;
  title: string;
  author: string;
  highlights: Array<JsonObject>;
  reviews: Array<JsonObject>;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function wereadBookFingerprint(book: WereadExportBook): string {
  const value = JSON.stringify({ highlights: book.highlights, reviews: book.reviews });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function safeWereadFilename(title: string): string {
  const printable = [...title].map((character) => (character.charCodeAt(0) < 32 ? '_' : character)).join('');
  return printable.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80) || '未命名书';
}

function noteDate(value: unknown): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function makeWereadMarkdown(books: WereadExportBook[], incremental = false): string {
  const lines: string[] = [
    '---', 'source: weread', `incremental: ${incremental}`, `exported_at: ${new Date().toISOString()}`, '---', '',
    incremental ? '# 微信读书增量笔记' : '# 微信读书笔记', '',
  ];
  for (const book of books) {
    lines.push(`## ${book.title}`, '', '```yaml', `book_id: ${yamlString(book.bookId)}`, `author: ${yamlString(book.author)}`, '```', '');
    let previousChapter = '';
    for (const highlight of book.highlights) {
      const chapter = objectOf(highlight.chapter);
      const chapterName = String(chapter.title || highlight.chapterTitle || '未分章节');
      if (chapterName !== previousChapter) {
        lines.push(`### ${chapterName}`, '');
        previousChapter = chapterName;
      }
      const text = String(highlight.markText || '').trim();
      if (!text) continue;
      const noteId = String(highlight.bookmarkId || '');
      if (noteId) lines.push(`<a id="weread-${noteId}"></a>`);
      lines.push(...text.split('\n').map((line) => `> ${line}`));
      const date = noteDate(highlight.createTime);
      if (date) lines.push('', `创建日期：${date}`);
      const deepLink = String(highlight.deepLink || '');
      if (deepLink) lines.push('', `[打开微信读书](${deepLink})`);
      lines.push('');
    }
    if (book.reviews.length) {
      lines.push('### 感想与点评', '');
    }
    for (const item of book.reviews) {
      const review = objectOf(item.review || item);
      const abstract = String(review.abstract || '').trim();
      const content = String(review.content || '').trim();
      const noteId = String(review.reviewId || '');
      if (noteId) lines.push(`<a id="weread-${noteId}"></a>`);
      if (abstract) lines.push(...abstract.split('\n').map((line) => `> ${line}`), '');
      if (content) lines.push(`**感想/点评：** ${content}`, '');
      const date = noteDate(review.createTime);
      if (date) lines.push(`创建日期：${date}`, '');
      const deepLink = String(review.deepLink || item.deepLink || '');
      if (deepLink) lines.push(`[打开微信读书](${deepLink})`, '');
    }
    if (!book.highlights.length && !book.reviews.length) lines.push('_没有可导出的笔记内容（书友仅支持数量统计）_', '');
  }
  return lines.filter((line, index) => line || lines[index - 1] !== '').join('\n');
}
