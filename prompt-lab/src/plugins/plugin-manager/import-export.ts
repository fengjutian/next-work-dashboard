import { pluginRegistry } from '../registry';
import { loadUserPlugins, saveUserPlugins, registerUserPlugin } from './user-plugin-store';
import type { UserPluginDef } from './user-plugin-store';
import type { PluginManifest } from '../sandbox/types';

const MAX_PLUGIN_FILE_SIZE = 2 * 1024 * 1024;
const PLUGIN_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SUPPORTED_API_VERSIONS = new Set(['1']);
const ALLOWED_PERMISSIONS = new Set([
  'store.read', 'clipboard', 'inject', 'external.open', 'data', 'preview',
  'file.read', 'file.write',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function derivePluginId(manifest: PluginManifest): string {
  return (manifest.id ?? manifest.name.replace(/\s+/g, '-')).trim().toLocaleLowerCase();
}

function validateBundle(bundle: unknown): { ok: true; manifest: PluginManifest } | { ok: false; message: string } {
  if (!isRecord(bundle) || bundle.format !== 'nwd-v1') {
    return { ok: false, message: '不支持的插件格式，需要 .nwd v1' };
  }
  if (!isRecord(bundle.manifest)) {
    return { ok: false, message: '插件缺少 manifest' };
  }

  const manifest = bundle.manifest as unknown as PluginManifest;
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 100) {
    return { ok: false, message: 'manifest.name 必须是 1–100 个字符' };
  }
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    return { ok: false, message: 'manifest.version 必须是有效的语义版本，例如 1.0.0' };
  }
  if (manifest.apiVersion && !SUPPORTED_API_VERSIONS.has(manifest.apiVersion)) {
    return { ok: false, message: `不支持的插件 API 版本: ${manifest.apiVersion}` };
  }
  if (manifest.runtime !== undefined && manifest.runtime !== 'sandbox' && manifest.runtime !== 'kernel') {
    return { ok: false, message: 'manifest.runtime 只能是 sandbox 或 kernel' };
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some((p) => !ALLOWED_PERMISSIONS.has(p))) {
    return { ok: false, message: 'manifest.permissions 包含未知权限' };
  }
  if (!PLUGIN_ID_PATTERN.test(derivePluginId(manifest))) {
    return { ok: false, message: '插件 ID 必须为 2–64 位字母、数字、点、下划线或连字符' };
  }

  const codeField = manifest.runtime === 'kernel' ? bundle.kernelBundle : bundle.script;
  if (typeof codeField !== 'string' || !codeField.trim()) {
    return { ok: false, message: manifest.runtime === 'kernel' ? '内核插件缺少 bundle 代码' : '插件脚本为空' };
  }
  if (bundle.style !== undefined && bundle.style !== null && typeof bundle.style !== 'string') {
    return { ok: false, message: '插件 style 必须是字符串' };
  }
  return { ok: true, manifest };
}

/** 导出单个用户插件为 .nwd (JSON 下载) */
export async function exportPlugin(def: UserPluginDef): Promise<void> {
  try {
    const manifest = def.manifest ?? {
      name: def.name,
      version: '0.1.0',
      permissions: def.permissions ?? [],
      iconEmoji: def.iconEmoji,
    };
    const cleanManifest = { apiVersion: '1', ...manifest, id: def.id };
    const isKernel = manifest.runtime === 'kernel' && def.bundle;

    const nwdBundle: any = {
      format: 'nwd-v1',
      manifest: cleanManifest,
    };
    if (isKernel) {
      nwdBundle.kernelBundle = def.bundle!;
    } else {
      nwdBundle.script = def.script ?? def.content ?? '';
      nwdBundle.style = def.style ?? null;
    }
    const bundleStr = JSON.stringify(nwdBundle, null, 2);

    const blob = new Blob([bundleStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}.nwd`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[exportPlugin] 导出失败', err);
    alert('导出失败：' + (err as Error).message);
  }
}

/** 从 .nwd 文件导入插件 */
export async function importPlugin(file: File): Promise<{ ok: boolean; message: string }> {
  try {
    if (file.size > MAX_PLUGIN_FILE_SIZE) {
      return { ok: false, message: '插件文件不能超过 2 MB' };
    }
    const text = await file.text();
    const bundle: unknown = JSON.parse(text);
    const validation = validateBundle(bundle);
    if ('message' in validation) return validation;
    const manifest = validation.manifest;
    const pluginBundle = bundle as Record<string, unknown>;

    const id = derivePluginId(manifest);
    const isKernel = manifest.runtime === 'kernel';
    const script = typeof pluginBundle.script === 'string' ? pluginBundle.script : '';
    const style = typeof pluginBundle.style === 'string' ? pluginBundle.style : '';
    const kernelBundle = typeof pluginBundle.kernelBundle === 'string' ? pluginBundle.kernelBundle : '';

    if (pluginRegistry.get(id)) {
      return { ok: false, message: `插件 "${id}" 已存在，请先删除旧版本` };
    }

    const def: UserPluginDef = {
      id,
      name: manifest.name,
      content: '',
      script: isKernel ? undefined : script,
      style: style || undefined,
      permissions: manifest.permissions ?? [],
      iconEmoji: manifest.iconEmoji,
      manifest,
      bundle: isKernel ? kernelBundle : undefined,
    };

    const defs = loadUserPlugins();
    defs.push(def);
    saveUserPlugins(defs);

    registerUserPlugin(def);

    return { ok: true, message: `已导入插件: ${manifest.name} v${manifest.version}` };
  } catch (err) {
    return { ok: false, message: '解析失败：' + (err as Error).message };
  }
}
