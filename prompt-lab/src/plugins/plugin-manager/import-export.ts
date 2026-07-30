import { pluginRegistry } from '../registry';
import { loadUserPlugins, saveUserPlugins, registerUserPlugin } from './user-plugin-store';
import type { UserPluginDef } from './user-plugin-store';
import type { PluginManifest } from '../sandbox/types';

/** 导出单个用户插件为 .nwd (JSON 下载) */
export async function exportPlugin(def: UserPluginDef): Promise<void> {
  try {
    const manifest = def.manifest ?? {
      name: def.name,
      version: '0.1.0',
      permissions: def.permissions ?? [],
      iconEmoji: def.iconEmoji,
    };
    const cleanManifest = { ...manifest };
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
    const text = await file.text();
    const bundle = JSON.parse(text);

    if (bundle.format !== 'nwd-v1') {
      return { ok: false, message: '不支持的格式，需要 .nwd v1' };
    }

    const manifest: PluginManifest = bundle.manifest;
    if (!manifest?.name) {
      return { ok: false, message: 'manifest.json 缺少 name 字段' };
    }

    const id = manifest.name.toLowerCase().replace(/\s+/g, '-');
    const isKernel = manifest.runtime === 'kernel';
    const script = bundle.script ?? '';
    const style = bundle.style ?? '';
    const kernelBundle = bundle.kernelBundle ?? '';

    if (isKernel && !kernelBundle) {
      return { ok: false, message: '内核插件缺少 bundle 代码' };
    }
    if (!isKernel && !script) {
      return { ok: false, message: '插件脚本为空' };
    }

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
