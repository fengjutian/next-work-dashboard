import { describe, expect, it } from 'vitest';

describe('@next-work-dashboard/windy', () => {
  it('exports the panel entry point', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.WindyPanel).toBe('function');
  });
});
