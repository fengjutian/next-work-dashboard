import { describe, expect, it } from 'vitest';
import { createChapterDocuments, createReadme, parseOutline } from '../src/plugins/outline-scaffolder/outline';

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
});
