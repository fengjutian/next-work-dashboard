export interface PluginRuntimeHook {
  isRunning(): boolean;
  stop(): Promise<void>;
  start(): Promise<void>;
}

const hooks = new Map<string, PluginRuntimeHook>();

export function registerPluginRuntimeHook(pluginId: string, hook: PluginRuntimeHook): () => void {
  hooks.set(pluginId, hook);
  return () => { if (hooks.get(pluginId) === hook) hooks.delete(pluginId); };
}

export async function switchPluginRuntime(pluginId: string, activate: () => Promise<void>, restore: () => Promise<void>): Promise<void> {
  const hook = hooks.get(pluginId);
  if (!hook) { await activate(); return; }
  const restart = hook.isRunning();
  if (restart) await hook.stop();
  try {
    await activate();
    if (restart) await hook.start();
  } catch (error) {
    await restore();
    if (restart) await hook.start().catch((restoreError) => {
      console.error(`[PluginRuntime] Failed to restart restored plugin "${pluginId}"`, restoreError);
    });
    throw error;
  }
}
