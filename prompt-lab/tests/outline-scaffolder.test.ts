import { describe, expect, it } from 'vitest';
import { calculateClaimCoverage, chapterStateAfterSave, compactTextDiff, createChapterDocuments, createReadme, isChapterArticle, parseOutline, sortChapterPaths } from '../src/plugins/outline-scaffolder/outline';

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

  it('distinguishes chapter articles from special markdown documents', () => {
    expect(isChapterArticle('docs/21-第二十一章 开始.md', '# 第二十一章 开始')).toBe(true);
    expect(isChapterArticle('docs/01-1.1 准备.md', '---\nchapter: true\n---\n# 准备')).toBe(true);
    expect(isChapterArticle('docs/404.md', '---\nchapter: true\n---\n# 页面未找到')).toBe(false);
    expect(isChapterArticle('docs/about.md', '# 关于')).toBe(false);
    expect(isChapterArticle('docs/custom.md', '---\nchapter: false\n---\n# 附录')).toBe(false);
  });

  it('creates a compact reversible text diff', () => {
    expect(compactTextDiff('秦法彻底摧毁旧制', '秦法显著改变了旧有制度')).toEqual({ prefix: '秦法', removed: '彻底摧毁旧制', added: '显著改变了旧有制度', suffix: '' });
  });

  it('counts only claims backed by verified evidence in coverage', () => {
    expect(calculateClaimCoverage([
      { status: 'supported', evidenceIds: ['verified'] },
      { status: 'supported', evidenceIds: ['clue'] },
      { status: 'disputed', evidenceIds: ['verified'] },
      { status: 'supported', evidenceIds: ['verified', 'clue'] },
    ], ['verified'])).toEqual({ total: 4, supported: 2, percentage: 50 });
  });

  it('excludes insufficient evidence from coverage', () => {
    expect(calculateClaimCoverage([
      { status: 'supported', evidenceIds: ['weak'], evidenceStrengths: { weak: 'insufficient' } },
      { status: 'supported', evidenceIds: ['direct'], evidenceStrengths: { direct: 'direct' } },
    ], ['weak', 'direct'])).toEqual({ total: 2, supported: 1, percentage: 50 });
  });
});
