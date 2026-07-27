declare module '@babel/standalone' {
  export function transform(
    code: string,
    options?: {
      presets?: string[];
      filename?: string;
      plugins?: string[];
    },
  ): { code?: string | null; map?: string | null; ast?: unknown };
}
