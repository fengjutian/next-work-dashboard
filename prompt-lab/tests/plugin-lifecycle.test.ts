import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../src/plugins/registry';
import type { Plugin, PluginContext } from '../src/plugins/types';

const EmptyComponent = () => null;

function createPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: 'test-plugin',
    name: 'Test plugin',
    icon: EmptyComponent,
    component: EmptyComponent,
    enabled: false,
    order: 1,
    ...overrides,
  };
}

describe('PluginRegistry lifecycle', () => {
  it('resolves declarative views, menus, settings, and file editors', () => {
    const registry = new PluginRegistry();
    registry.register(createPlugin({
      enabled: true,
      contributions: {
        views: [{ id: 'test.view', title: 'Test', component: EmptyComponent }],
        menus: [{ id: 'test.menu', label: 'Test', command: 'test.run', location: 'file' }],
        settings: [{ key: 'test.enabled', label: 'Enabled', type: 'boolean' }],
        fileEditors: [{ id: 'test.editor', extensions: ['.test'], viewId: 'test.view', priority: 5 }],
      },
    }));

    expect(registry.getViews()[0]).toMatchObject({ id: 'test.view', pluginId: 'test-plugin' });
    expect(registry.getMenus('file')[0]).toMatchObject({ id: 'test.menu', pluginId: 'test-plugin' });
    expect(registry.getSettings()[0]).toMatchObject({ key: 'test.enabled', pluginId: 'test-plugin' });
    expect(registry.resolveFileEditor('example.TEST')).toMatchObject({ id: 'test.editor', pluginId: 'test-plugin' });
  });

  it('activates on enable and disposes resources before deactivation', async () => {
    const registry = new PluginRegistry();
    const dispose = vi.fn();
    const deactivate = vi.fn();
    const activate = vi.fn((context: PluginContext) => {
      context.subscriptions.add(dispose);
    });

    registry.register(createPlugin({ activate, deactivate }));
    registry.setEnabled('test-plugin', true);
    await Promise.resolve();

    expect(activate).toHaveBeenCalledOnce();
    expect(registry.getLifecycleState('test-plugin')).toBe('active');

    registry.setEnabled('test-plugin', false);
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    expect(deactivate).toHaveBeenCalledOnce();
    expect(registry.getLifecycleState('test-plugin')).toBe('inactive');
  });

  it('disposes a late activation result after the plugin was disabled', async () => {
    const registry = new PluginRegistry();
    const lateDispose = vi.fn();
    let finishActivation: ((dispose: () => void) => void) | undefined;
    const activate = () => new Promise<() => void>((resolve) => {
      finishActivation = resolve;
    });

    registry.register(createPlugin({ activate }));
    registry.setEnabled('test-plugin', true);
    registry.setEnabled('test-plugin', false);
    finishActivation?.(lateDispose);
    await Promise.resolve();

    expect(lateDispose).toHaveBeenCalledOnce();
    expect(registry.getLifecycleState('test-plugin')).toBe('inactive');
  });
});
