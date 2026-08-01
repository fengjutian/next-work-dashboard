import { describe, expect, it } from 'vitest';
import { createTypeScriptSemanticIndex } from '../src/main/typescript-language-service';

describe('TypeScript language service semantic index', () => {
  it('resolves definitions, import aliases and references across files', () => {
    const index = createTypeScriptSemanticIndex({
      '/types.ts': 'export interface User { name: string }',
      '/main.ts': "import type { User } from './types';\nconst current: User = { name: 'Ada' };\nconsole.log(current);",
    });
    const results = index.search('/main.ts', 2, 16);
    expect(results.some((item) => item.path === '/types.ts' && item.kind === 'definition')).toBe(true);
    expect(results.some((item) => item.path === '/main.ts' && item.kind === 'import')).toBe(true);
    index.dispose();
  });
});
