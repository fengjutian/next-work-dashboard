import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OfficeCliStatus, OfficeOperationResult, OfficeRenderResult } from '../types';

const execFileAsync = promisify(execFile);
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const MAX_OUTPUT = 20 * 1024 * 1024;

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
