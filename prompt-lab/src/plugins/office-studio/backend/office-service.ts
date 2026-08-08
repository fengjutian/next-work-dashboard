import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OfficeAddRequest, OfficeCliStatus, OfficeOperationResult, OfficeRenderResult, OfficeSetRequest } from '../types';

const execFileAsync = promisify(execFile);
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const MAX_OUTPUT = 20 * 1024 * 1024;
const MAX_HISTORY = 20;
const histories = new Map<string, { undo: string[]; redo: string[] }>();

function bundledExecutableCandidates(): string[] {
  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const executable = process.platform === 'win32' ? 'officecli.exe' : 'officecli';
  const resourceRoot = app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), 'resources');
  return [
    path.join(resourceRoot, 'officecli', `${platform}-${arch}`, executable),
    path.join(resourceRoot, 'officecli', executable),
  ];
}

export function resolveOfficeCliExecutable(): { executable: string; bundled: boolean } {
  const configured = process.env.OFFICECLI_PATH?.trim();
  if (configured && fs.existsSync(configured)) return { executable: configured, bundled: false };
  const bundled = bundledExecutableCandidates().find((candidate) => fs.existsSync(candidate));
  if (bundled) return { executable: bundled, bundled: true };
  return { executable: process.platform === 'win32' ? 'officecli.exe' : 'officecli', bundled: false };
}

function validateDocumentPath(filePath: string, mustExist = true): string {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new Error('INVALID_OFFICE_PATH');
  const absolute = path.resolve(filePath);
  if (!SUPPORTED_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new Error('UNSUPPORTED_OFFICE_FORMAT');
  if (mustExist && (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())) throw new Error('OFFICE_FILE_NOT_FOUND');
  return absolute;
}

function validateDomExpression(value: string, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 1000 || /[\r\n\0]/.test(trimmed)) throw new Error(`INVALID_OFFICE_${label}`);
  return trimmed;
}

function propertyArgs(properties: Record<string, string>, allowEmpty = false): string[] {
  const entries = Object.entries(properties ?? {});
  if ((!allowEmpty && !entries.length) || entries.length > 50) throw new Error('INVALID_OFFICE_PROPERTIES');
  return entries.flatMap(([key, value]) => {
    if (!/^[A-Za-z][\w.-]{0,99}$/.test(key) || typeof value !== 'string' || value.length > 100_000 || /\0/.test(value)) {
      throw new Error('INVALID_OFFICE_PROPERTY');
    }
    return ['--prop', `${key}=${value}`];
  });
}

async function runOfficeCli(args: string[], timeout = 30_000): Promise<string> {
  const { executable } = resolveOfficeCliExecutable();
  const result = await execFileAsync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT,
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
  });
  return result.stdout.trim();
}

function historyFor(target: string) {
  let history = histories.get(target);
  if (!history) {
    history = { undo: [], redo: [] };
    histories.set(target, history);
  }
  return history;
}

async function createHistorySnapshot(target: string): Promise<string> {
  const directory = path.join(app.getPath('temp'), 'next-work-office-history');
  await fs.promises.mkdir(directory, { recursive: true });
  const snapshot = path.join(directory, `${path.basename(target)}-${crypto.randomUUID()}.bak`);
  await fs.promises.copyFile(target, snapshot);
  return snapshot;
}

async function clearSnapshots(snapshots: string[]): Promise<void> {
  await Promise.all(snapshots.splice(0).map((snapshot) => fs.promises.rm(snapshot, { force: true }).catch(() => undefined)));
}

async function pushUndo(target: string, snapshot: string): Promise<void> {
  const history = historyFor(target);
  history.undo.push(snapshot);
  await clearSnapshots(history.redo);
  while (history.undo.length > MAX_HISTORY) {
    const expired = history.undo.shift();
    if (expired) await fs.promises.rm(expired, { force: true }).catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  const candidate = error as { code?: string; stderr?: string; message?: string };
  if (candidate.code === 'ENOENT') return '未找到 OfficeCLI。请安装 OfficeCLI，或将二进制放入 resources/officecli/<平台-架构>/。';
  return candidate.stderr?.trim() || candidate.message || String(error);
}

function constrainPreviewHtml(html: string): string {
  const policy = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    : `${meta}${html}`;
}

export async function getOfficeCliStatus(): Promise<OfficeCliStatus> {
  const resolved = resolveOfficeCliExecutable();
  try {
    const version = await runOfficeCli(['--version'], 10_000);
    return { available: true, version, executable: resolved.executable, bundled: resolved.bundled };
  } catch (error) {
    return { available: false, executable: resolved.executable, bundled: resolved.bundled, error: errorMessage(error) };
  }
}

export async function createOfficeDocument(filePath: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath, false);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const output = await runOfficeCli(['create', target]);
    return { success: true, output };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function getOfficeOutline(filePath: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    return { success: true, output: await runOfficeCli(['view', target, 'outline']) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function getOfficeElement(filePath: string, domPath: string, depth = 2): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    const safeDepth = Math.max(0, Math.min(10, Math.trunc(depth)));
    const output = await runOfficeCli(['get', target, validateDomExpression(domPath, 'PATH'), '--depth', String(safeDepth), '--json']);
    return { success: true, output };
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function queryOfficeElements(filePath: string, selector: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    const output = await runOfficeCli(['query', target, validateDomExpression(selector, 'SELECTOR'), '--compact']);
    return { success: true, output };
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

async function mutateOfficeDocument(filePath: string, args: string[]): Promise<OfficeOperationResult> {
  const target = validateDocumentPath(filePath);
  const backup = await createHistorySnapshot(target);
  try {
    const output = await runOfficeCli(args);
    await runOfficeCli(['save', target, '--json']);
    await pushUndo(target, backup);
    const history = historyFor(target);
    return { success: true, output, canUndo: true, canRedo: history.redo.length > 0 };
  } catch (error) {
    await runOfficeCli(['close', target]).catch(() => undefined);
    await fs.promises.copyFile(backup, target).catch(() => undefined);
    await fs.promises.rm(backup, { force: true }).catch(() => undefined);
    return { success: false, error: errorMessage(error) };
  }
}

async function restoreHistory(filePath: string, direction: 'undo' | 'redo'): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    const history = historyFor(target);
    const sourceStack = history[direction];
    const destinationStack = history[direction === 'undo' ? 'redo' : 'undo'];
    const snapshot = sourceStack.pop();
    if (!snapshot) return { success: false, error: direction === 'undo' ? '没有可撤销的操作' : '没有可重做的操作', canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 };
    await runOfficeCli(['close', target]).catch(() => undefined);
    const current = await createHistorySnapshot(target);
    await fs.promises.copyFile(snapshot, target);
    await fs.promises.rm(snapshot, { force: true }).catch(() => undefined);
    destinationStack.push(current);
    return { success: true, output: direction === 'undo' ? '已撤销' : '已重做', canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 };
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export const undoOfficeDocument = (filePath: string) => restoreHistory(filePath, 'undo');
export const redoOfficeDocument = (filePath: string) => restoreHistory(filePath, 'redo');

export async function disposeOfficeService(): Promise<void> {
  const snapshots = [...histories.values()].flatMap((history) => [...history.undo, ...history.redo]);
  histories.clear();
  await clearSnapshots(snapshots);
}

export async function setOfficeProperties(request: OfficeSetRequest): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(request.filePath);
    return await mutateOfficeDocument(target, ['set', target, validateDomExpression(request.path, 'PATH'), ...propertyArgs(request.properties), '--json']);
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function addOfficeElement(request: OfficeAddRequest): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(request.filePath);
    const type = request.type?.trim();
    if (!/^[A-Za-z][\w-]{0,49}$/.test(type)) throw new Error('INVALID_OFFICE_ELEMENT_TYPE');
    const indexArgs = request.index === undefined ? [] : ['--index', String(Math.max(0, Math.trunc(request.index)))];
    return await mutateOfficeDocument(target, ['add', target, validateDomExpression(request.path, 'PATH'), '--type', type, ...indexArgs, ...propertyArgs(request.properties, true), '--json']);
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function removeOfficeElement(filePath: string, domPath: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    if (domPath === '/') throw new Error('OFFICE_ROOT_REMOVE_FORBIDDEN');
    return await mutateOfficeDocument(target, ['remove', target, validateDomExpression(domPath, 'PATH'), '--json']);
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function saveOfficeDocument(filePath: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    return { success: true, output: await runOfficeCli(['save', target, '--json']) };
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function mergeOfficeTemplate(templatePath: string, outputPath: string, data: Record<string, unknown>): Promise<OfficeOperationResult> {
  try {
    const template = validateDocumentPath(templatePath);
    const output = validateDocumentPath(outputPath, false);
    if (path.extname(template).toLowerCase() !== path.extname(output).toLowerCase()) throw new Error('OFFICE_MERGE_FORMAT_MISMATCH');
    const serialized = JSON.stringify(data);
    if (!serialized || serialized.length > 2 * 1024 * 1024) throw new Error('INVALID_OFFICE_MERGE_DATA');
    return { success: true, output: await runOfficeCli(['merge', template, output, '--data', serialized], 60_000) };
  } catch (error) { return { success: false, error: errorMessage(error) }; }
}

export async function renderOfficeHtml(filePath: string): Promise<OfficeRenderResult> {
  let temporaryDirectory: string | undefined;
  try {
    const target = validateDocumentPath(filePath);
    temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'next-work-office-'));
    const outputPath = path.join(temporaryDirectory, 'preview.html');
    await runOfficeCli(['view', target, 'html', '-o', outputPath], 60_000);
    const html = await fs.promises.readFile(outputPath, 'utf8');
    return { success: true, html: constrainPreviewHtml(html) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  } finally {
    if (temporaryDirectory) await fs.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function closeOfficeDocument(filePath: string): Promise<OfficeOperationResult> {
  try {
    const target = validateDocumentPath(filePath);
    return { success: true, output: await runOfficeCli(['close', target]) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
