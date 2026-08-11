// Ambient declaration for `cytoscape-fcose`, which ships no .d.ts.
// We don't need the real shape — we just need TS to accept the import
// so the call site can pass it to `cytoscape.use()`.
declare module 'cytoscape-fcose';
