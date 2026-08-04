import { describe, expect, it, vi } from 'vitest';
import { requestEditorNavigation, subscribeEditorNavigation } from '../src/services/editor-navigation';

describe('editor navigation bridge', () => {
  it('delivers live navigation requests with line and workspace context', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEditorNavigation(listener);
    requestEditorNavigation({ rootPath: 'D:\\knowledge', path: 'notes/a.md', line: 7, column: 2 });
    expect(listener).toHaveBeenCalledWith({ rootPath: 'D:\\knowledge', path: 'notes/a.md', line: 7, column: 2 });
    unsubscribe();
  });

  it('queues a request until the keep-alive editor mounts', async () => {
    requestEditorNavigation({ rootPath: 'D:\\knowledge', path: 'notes/pending.md', line: 3 });
    const listener = vi.fn();
    const unsubscribe = subscribeEditorNavigation(listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith({ rootPath: 'D:\\knowledge', path: 'notes/pending.md', line: 3 });
    unsubscribe();
  });
});
