import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

/**
 * Parse simple top-level `const NAME = { ... } as const` tables so handlers
 * registered with constants (e.g. `ipcMain.handle(VIDEO_IPC.OPEN, ...)`)
 * resolve to their string channel. Only flat KEY: 'value' entries.
 */
function parseConstants(source) {
  const constants = {};
  const declRegex = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?/g;
  for (const match of source.matchAll(declRegex)) {
    const name = match[1];
    const table = {};
    for (const entry of match[2].matchAll(/([A-Z_][A-Z0-9_]*)\s*:\s*['"]([^'"]+)['"]/g)) {
      table[entry[1]] = entry[2];
    }
    if (Object.keys(table).length) constants[name] = table;
  }
  return constants;
}

/**
 * Resolve a captured first-argument expression. The capture group for a
 * literal already strips the surrounding quotes; the capture group for a
 * constant reference is the `NAME.MEMBER` form. Anything else (template
 * literals with `${...}`, expressions, etc.) is rejected.
 */
function resolveChannel(expr, constants) {
  if (!expr) return null;
  expr = expr.trim();
  // Constant reference: NAME.MEMBER
  const dot = expr.match(/^([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)$/);
  if (dot) {
    if (constants[dot[1]] && constants[dot[1]][dot[2]] !== undefined) {
      return constants[dot[1]][dot[2]];
    }
    return null;
  }
  // Plain string (capture group has already stripped quotes). Reject
  // anything that looks dynamic.
  if (expr.includes('${')) return null;
  return expr;
}

/**
 * Match either a string literal or a `NAME.MEMBER` constant ref.
 *
 * Restrictive on the constant form to avoid swallowing unrelated code
 * like `JS.E` or `XLSX.C` (TS types). Real IPC constants look like
 * `VIDEO_IPC.OPEN` or `STORAGE_KEYS.CLEANER_OPTIONS`: a UPPER_SNAKE
 * name with at least 3 chars and an underscore, paired with a
 * UPPER_SNAKE member of at least 2 chars.
 */
const CONST_NAME = `[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+`;
const CONST_MEMBER = `[A-Z][A-Z0-9_]{1,}`;
const CHANNEL_ARG = `(?:['"]([^'"]+)['"]|(${CONST_NAME}\\.${CONST_MEMBER}))`;
const PUSH_ARG = `(?:['"\`]([^'"\`]+)['"\`])|(${CONST_NAME}\\.${CONST_MEMBER})`;

/**
 * Parse a simple `${prefix}:${suffix}` template literal as a pattern.
 * Used to flag push channels whose suffix is dynamic.
 */
function templatePrefix(literal) {
  const m = literal.match(/^([^'"`]+?):\$\{/);
  return m ? `${m[1]}:` : null;
}

const sourceFiles = filesUnder(path.join(root, 'src'));
const handlers = new Set();
const invocations = new Set();
const pushSends = new Set();
const pushSubscribes = new Set();
const dynamicPushPrefixes = new Set();
let dynamicChannelCount = 0;

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const constants = parseConstants(source);

  for (const match of source.matchAll(new RegExp(`ipcMain\\.handle\\(\\s*${CHANNEL_ARG}`, 'g'))) {
    const channel = resolveChannel(match[1] || match[2], constants);
    if (channel) handlers.add(channel);
  }

  for (const match of source.matchAll(new RegExp(`ipcRenderer\\.invoke\\(\\s*${CHANNEL_ARG}`, 'g'))) {
    const channel = resolveChannel(match[1] || match[2], constants);
    if (channel) invocations.add(channel);
  }

  // webContents.send / event.sender.send / sender.send — one-way push
  // from main to renderer. Bare `sender.send` is the common idiom inside
  // an `ipcMain.handle((event, ...) => { ... })` body where `sender`
  // shadows `event.sender`.
  for (const match of source.matchAll(new RegExp(`(?:webContents|event\\.sender|sender)\\.send\\(\\s*${PUSH_ARG}`, 'g'))) {
    const raw = match[1] || match[2];
    if (!raw) continue;
    if (raw.includes('${')) {
      const prefix = templatePrefix(raw);
      if (prefix) dynamicPushPrefixes.add(prefix);
      dynamicChannelCount += 1;
      continue;
    }
    const channel = resolveChannel(raw, constants);
    if (channel) pushSends.add(channel);
  }

  // ipcRenderer.on — push subscriber
  for (const match of source.matchAll(new RegExp(`ipcRenderer\\.on\\(\\s*${PUSH_ARG}`, 'g'))) {
    const raw = match[1] || match[2];
    if (!raw) continue;
    if (raw.includes('${')) {
      dynamicChannelCount += 1;
      continue;
    }
    const channel = resolveChannel(raw, constants);
    if (channel) pushSubscribes.add(channel);
  }
}

const missingHandlers = [...invocations].filter((c) => !handlers.has(c)).sort();
const unusedHandlers = [...handlers]
  // `*:on-event` no-op markers are intentional sentinels for push event
  // channels (see plugins/*/backend/*-service.ts).
  .filter((c) => !invocations.has(c) && !c.endsWith(':on-event'))
  .sort();
const orphanPushes = [...pushSends]
  .filter((c) => !pushSubscribes.has(c) && !c.endsWith(':on-event'))
  .sort();
const orphanSubscribes = [...pushSubscribes].filter((c) => !pushSends.has(c)).sort();

let hasError = false;
if (missingHandlers.length) {
  hasError = true;
  console.error(`IPC invoked without handler:\n${missingHandlers.map((c) => `  - ${c}`).join('\n')}`);
}
if (unusedHandlers.length) {
  hasError = true;
  console.error(`IPC handler without preload invocation:\n${unusedHandlers.map((c) => `  - ${c}`).join('\n')}`);
}

if (hasError) {
  process.exitCode = 1;
} else {
  const parts = [`${handlers.size} request/response channels`, `${pushSends.size} push channels`];
  if (dynamicChannelCount) parts.push(`${dynamicChannelCount} dynamic (skipped: ${[...dynamicPushPrefixes].join(', ') || 'n/a'})`);
  console.log(`IPC contract OK: ${parts.join(', ')}.`);
  if (orphanPushes.length) console.warn(`Push channels with no renderer subscriber (informational):\n${orphanPushes.map((c) => `  - ${c}`).join('\n')}`);
  if (orphanSubscribes.length) console.warn(`Renderer subscriptions with no main send (informational):\n${orphanSubscribes.map((c) => `  - ${c}`).join('\n')}`);
}
