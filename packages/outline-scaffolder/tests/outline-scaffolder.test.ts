import { describe, expect, it } from 'vitest';
import { buildRegenerationSkeleton, calculateClaimCoverage, chapterStateAfterSave, compactTextDiff, createChapterDocuments, createReadme, isChapterArticle, normalizeGeneratedMarkdown, parseOutline, sortChapterPaths } from '../src/core';
import { createTransportOutlineScaffolderAdapter } from '../src/platform/transport';
import { createHttpOutlineScaffolderTransport } from '../src/web';
import { createTauriOutlineScaffolderTransport, type TauriInvoke } from '../src/tauri';

describe('outline scaffolder', () => {
  it('maps host calls onto the shared web and Tauri transport protocol', async () => {
    const calls: Array<{ operation: string; args: unknown[] }> = [];
    const adapter = createTransportOutlineScaffolderAdapter(async (operation, args) => {
      calls.push({ operation, args });
      return { success: true };
    }, { model: 'test-model' });

    await adapter.files.writeText('book', '01-intro.md', '# Intro');
    await adapter.api.outlineResearch.search(['primary sources']);
    await adapter.api.workBrowser.search.run({ query: 'timeline' });

    expect(adapter.aiConfig).toMatchObject({ apiKey: '', baseUrl: '', model: 'test-model' });
    expect(calls).toEqual([
      { operation: 'workspace.writeTextFile', args: ['book', '01-intro.md', '# Intro'] },
      { operation: 'outlineResearch.search', args: [['primary sources']] },
      { operation: 'workBrowser.search.run', args: [{ query: 'timeline' }] },
    ]);
  });

  it('posts Web host operations using the shared protocol', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const transport = createHttpOutlineScaffolderTransport({
      endpoint: '/api/outline',
      fetch: async (input, init) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ result: { success: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await expect(transport('workspace.listFiles', ['book'])).resolves.toEqual({ success: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].input).toBe('/api/outline');
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      operation: 'workspace.listFiles',
      args: ['book'],
    });
  });

  it('invokes a Tauri command using the shared protocol', async () => {
    const calls: unknown[] = [];
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return { success: true } as T;
    };
    const transport = createTauriOutlineScaffolderTransport(invoke, 'chapter_host');

    await transport('shell.openExternal', ['https://example.com']);
    expect(calls).toEqual([{
      command: 'chapter_host',
      args: { operation: 'shell.openExternal', args: ['https://example.com'] },
    }]);
  });

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
    expect(sections.map((item) => item.path)).toEqual(['书/01-第一篇 基础/01-1.1 准备.md', '书/01-第一篇 基础/02-1.2 安装.md']);
    const single = createChapterDocuments(nodes, { folder: '书', splitMode: 'single', projectTitle: '指南' });
    expect(single).toHaveLength(1);
    expect(single[0].path).toBe('书/指南.md');
  });

  it('prefixes part directories so lexicographic hosts keep outline order', () => {
    const source = Array.from({ length: 12 }, (_, index) => `# 第${index + 1}部\n## 第${index + 1}章 章节`).join('\n');
    const paths = createChapterDocuments(parseOutline(source), { organizeByPart: true }).map((item) => item.path);
    expect(paths[0]).toMatch(/^01-/);
    expect(paths[6]).toMatch(/^07-/);
    expect(paths[11]).toMatch(/^12-/);
    expect([...paths].sort()).toEqual(paths);
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

  it('removes an outer markdown fence from generated articles', () => {
    expect(normalizeGeneratedMarkdown('```markdown\n---\nchapter: true\n---\n# 正文\n```'))
      .toBe('---\nchapter: true\n---\n# 正文');
    expect(normalizeGeneratedMarkdown('# 正文')).toBe('# 正文');
  });

  it('rebuilds a chapter skeleton without retaining stale prose', () => {
    const skeleton = buildRegenerationSkeleton('---\nchapter: true\n---\n<!-- chapter-writing-brief\n目标：责任\n-->\n# 第七十章 责任\n秦汉旧正文\n## 选择负责\n更多旧正文');
    expect(skeleton).toContain('目标：责任');
    expect(skeleton).toContain('## 选择负责');
    expect(skeleton).not.toContain('秦汉旧正文');
    expect(skeleton).not.toContain('更多旧正文');
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
