import { describe, expect, it } from 'vitest';
import { chapterStateAfterSave, createChapterDocuments, createReadme, parseOutline, sortChapterPaths } from '../src/plugins/outline-scaffolder/outline';

describe('outline scaffolder', () => {
  it('parses markdown and creates one document per chapter', () => {
    const nodes = parseOutline('# 第一篇 基础\n## 第一章 开始\n### 1.1 准备\n## 第二章 使用');
    const documents = createChapterDocuments(nodes, 'docs');
    expect(documents).toHaveLength(2);
    expect(documents[0].path).toBe('docs/01-第一章 开始.md');
    expect(documents[0].content).toContain('## 1.1 准备');
    expect(createReadme(documents, '手册', 'docs')).toMatchObject({ path: 'docs/README.md' });
  });

  it('sanitizes filenames', () => {
    const documents = createChapterDocuments(parseOutline('第一章 A/B: C'));
    expect(documents[0].path).toBe('01-第一章 A-B- C.md');
  });

  it('recognizes a plain-text Chinese outline', () => {
    const documents = createChapterDocuments(parseOutline('第一篇 基础\n第一章 开始\n1.1 准备\n第二章 使用'));
    expect(documents).toHaveLength(2);
    expect(documents[0].content).toContain('## 1.1 准备');
  });

  it('supports section, single-file and part-folder modes', () => {
    const nodes = parseOutline('# 第一篇 基础\n## 第一章 开始\n### 1.1 准备\n### 1.2 安装');
    const sections = createChapterDocuments(nodes, { folder: '书', splitMode: 'section', organizeByPart: true });
    expect(sections.map((item) => item.path)).toEqual(['书/第一篇 基础/01-1.1 准备.md', '书/第一篇 基础/02-1.2 安装.md']);
    const single = createChapterDocuments(nodes, { folder: '书', splitMode: 'single', projectTitle: '指南' });
    expect(single).toHaveLength(1);
    expect(single[0].path).toBe('书/指南.md');
  });

  it('advances saved chapters through explicit review stages', () => {
    expect(chapterStateAfterSave('pending')).toBe('draft');
    expect(chapterStateAfterSave('error')).toBe('draft');
    expect(chapterStateAfterSave('draft')).toBe('draft');
    expect(chapterStateAfterSave('review')).toBe('review');
    expect(chapterStateAfterSave('revising')).toBe('quality');
    expect(chapterStateAfterSave('complete')).toBe('complete');
  });

  it('sorts and deduplicates discovered chapter files by numeric prefix', () => {
    expect(sortChapterPaths(['docs/28-尾声.md', 'docs/02-开端.md', 'docs/12-转折.md', 'docs/02-开端.md']))
      .toEqual(['docs/02-开端.md', 'docs/12-转折.md', 'docs/28-尾声.md']);
  });
});
