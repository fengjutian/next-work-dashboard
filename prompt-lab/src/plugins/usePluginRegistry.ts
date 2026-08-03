import { useSyncExternalStore } from 'react';
import { pluginRegistry } from './registry';

const subscribe = pluginRegistry.subscribe.bind(pluginRegistry);

/** Subscribe a component to registry changes without force-render state counters. */
export function usePluginRegistryVersion(): number {
  return useSyncExternalStore(
    subscribe,
    pluginRegistry.getVersion,
    pluginRegistry.getVersion,
  );
}
