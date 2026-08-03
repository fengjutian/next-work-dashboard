export type EnvironmentLayer = Record<string, string | undefined>;

export function mergeEnvironmentLayers(...layers: EnvironmentLayer[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
  }
  return merged;
}

export function resolveSecretReferences(env: Record<string, string>, readSecret: (name: string) => string | null): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value.replace(/\$\{secret:([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_match, name: string) => {
    const secret = readSecret(name);
    if (secret === null) throw new Error(`TERMINAL_SECRET_NOT_FOUND:${name}`);
    return secret;
  })]));
}
