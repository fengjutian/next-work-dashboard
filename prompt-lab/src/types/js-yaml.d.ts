declare module 'js-yaml' {
  export function load(content: string): unknown;
  export function dump(value: unknown, options?: { indent?: number; noRefs?: boolean; sortKeys?: boolean; lineWidth?: number }): string;
}
