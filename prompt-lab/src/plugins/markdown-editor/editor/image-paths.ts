/**
 * 本地图片插入的路径计算。
 *
 * 提出来便于测试：业务逻辑不依赖 DOM / IPC，纯函数。
 */

const MAX_INLINE_BYTES = 200 * 1024;

function sanitizeAssetName(name: string): string {
  // 保留 ASCII 字母数字 + 标点 + CJK 字符；其他（路径分隔符、特殊符号）替换为连字符
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']);

/** 判断文件是否可作为图片插入。 */
export function isImageFile(file: { name: string; type?: string }): boolean {
  if (file.type && IMAGE_TYPES.has(file.type)) return true;
  return IMAGE_EXT_PATTERN.test(file.name);
}

/** 计算图片在工作区中的相对路径（用于 Markdown 引用）。 */
export function pickAssetPath(documentRelativePath: string | null, fileName: string): string {
  const extMatch = fileName.match(IMAGE_EXT_PATTERN);
  const ext = extMatch?.[1]?.toLowerCase() ?? 'png';
  const base = sanitizeAssetName(fileName.replace(/\.[^.]+$/, ''));
  const target = `assets/${base}-${timestampSuffix()}.${ext}`;
  if (!documentRelativePath) return target;
  const dir = documentRelativePath.includes('/') ? documentRelativePath.replace(/\/[^/]+$/, '') : '';
  if (!dir) return target;
  return `../${target}`;
}

/** 是否需要落盘（vs 直接 base64 嵌入）。 */
export function shouldStoreOnDisk(fileSize: number, hasWorkspaceRoot: boolean): boolean {
  return hasWorkspaceRoot && fileSize <= MAX_INLINE_BYTES;
}

/** 上限常量（供 UI 提示用）。 */
export const IMAGE_INLINE_LIMIT_BYTES = MAX_INLINE_BYTES;
