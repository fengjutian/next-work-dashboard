import { describe, expect, it } from 'vitest';
import { extractWikiLinks } from '../src/core/knowledge/markdown';

describe('knowledge markdown links', () => {
  it('extracts wiki, embedded and relative markdown links with anchors', () => {
    const links = extractWikiLinks('[[Wiki]]\n![[Embed]]\n[Design](../docs/design.md#api)\n![Diagram](assets/diagram.md)');
    expect(links.map((link) => link.kind)).toEqual(['wiki', 'wiki', 'markdown', 'markdown']);
    expect(links[2]).toMatchObject({ target: '../docs/design.md', anchor: 'api', label: 'Design' });
    expect(links[3].embedded).toBe(true);
  });
});
