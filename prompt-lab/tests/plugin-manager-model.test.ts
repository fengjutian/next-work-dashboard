import { describe, expect, it } from 'vitest';
import type { Plugin } from '../src/plugins/types';
import { categorizePlugins, filterPluginCategories, pluginCategory } from '../src/plugins/plugin-manager/model';

const plugin = (id: string, name: string, enabled: boolean): Plugin => ({
  id,
  name,
  enabled,
  order: 0,
  icon: () => null,
  component: () => null,
});

describe('plugin manager model', () => {
  it('classifies built-in, custom, and unknown plugins', () => {
    expect(pluginCategory('chat', false)).toBe('ai');
    expect(pluginCategory('anything', true)).toBe('custom');
    expect(pluginCategory('anything', false)).toBe('system');
  });

  it('groups plugins and removes empty categories', () => {
    const categories = categorizePlugins(
      [plugin('chat', 'AI Chat', true), plugin('my-addon', 'My Addon', false)],
      new Set(['my-addon']),
    );

    expect(categories.map((category) => category.id)).toEqual(['ai', 'custom']);
    expect(categories[1].plugins[0].id).toBe('my-addon');
  });

  it('filters by category, status, name, and id', () => {
    const categories = categorizePlugins(
      [plugin('chat', 'AI Chat', true), plugin('style-image', 'Image Studio', false)],
      new Set(),
    );

    expect(filterPluginCategories(categories, { category: 'ai', status: 'enabled', query: 'chat' })[0].plugins)
      .toHaveLength(1);
    expect(filterPluginCategories(categories, { category: 'all', status: 'disabled', query: 'STYLE-' })[0].plugins[0].id)
      .toBe('style-image');
    expect(filterPluginCategories(categories, { category: 'all', status: 'enabled', query: 'missing' }))
      .toEqual([]);
  });
});
