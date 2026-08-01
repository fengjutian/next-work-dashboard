import { describe, expect, it } from 'vitest';
import { findSemanticMatches } from '../src/main/semantic-search';

describe('findSemanticMatches', () => {
  it('classifies definitions, imports and references', () => {
    const source = "import { User } from './types';\nexport class UserService {}\nconst value = new User();\nnew UserService();";
    expect(findSemanticMatches('service.ts', source, 'User').map((item) => item.kind)).toEqual(['import', 'reference']);
    expect(findSemanticMatches('service.ts', source, 'UserService').map((item) => item.kind)).toEqual(['definition', 'reference']);
  });
  it('rejects non-symbol queries', () => expect(findSemanticMatches('a.ts', 'const a = 1', 'a.*')).toEqual([]));
});
