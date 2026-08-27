/**
 * prompt-lab wrapper for @next-work-dashboard/windy.
 *
 * The package itself is host-agnostic; this file re-exports the
 * published panel so the built-in plugin entry point stays at
 * `../windy` (matches `import('../windy').then(m => m.WindyPanel)`
 * in `src/plugins/built-in/index.ts`).
 */

export { WindyPanel } from "@next-work-dashboard/windy/react";
