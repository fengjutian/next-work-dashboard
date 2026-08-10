/**
 * 插件级常量：localStorage 键、自动保存延迟、UI 默认值、文件大小阈值等。
 *
 * 集中放这里是为了让 `useMarkdownDocuments` 和 UI 组件都能引用同一份配置。
 */

import type { MarkdownEditorMode } from './types';

/** 插件 ID（必须和 built-in/index.ts 注册的一致）。 */
export const PLUGIN_ID = 'markdown-editor';

/** 文件编辑器贡献 ID（注册到 fileEditors 列表里）。 */
export const FILE_EDITOR_ID = `${PLUGIN_ID}.default`;

/** 视图 ID（注册到 fileEditors.viewId，对应 main 区域面板）。 */
export const FILE_EDITOR_VIEW_ID = `${PLUGIN_ID}.main`;

/** localStorage 键：最近打开的文档快照列表。 */
export const STORAGE_KEY_RECENT = `${PLUGIN_ID}.recent-documents.v1`;

/** localStorage 键：用户偏好。 */
export const STORAGE_KEY_PREFERENCES = `${PLUGIN_ID}.preferences.v1`;

/** 自动保存停手延迟（ms）。停止输入后等这段时间才触发自动保存。 */
export const AUTO_SAVE_IDLE_MS = 1500;

/** 触发"大文件"提示的字节阈值。超过此值给用户提示，建议切到源码模式。 */
export const LARGE_FILE_BYTE_THRESHOLD = 5 * 1024 * 1024; // 5 MB

/** 触发"大文件"自动降级源码模式的更严格阈值。 */
export const LARGE_FILE_AUTO_SOURCE_MODE = 10 * 1024 * 1024; // 10 MB

/** 受支持的 Markdown 文件扩展名（小写，含 `.`）。 */
export const SUPPORTED_EXTENSIONS: ReadonlyArray<string> = ['.md', '.markdown'];

/** 用户偏好默认值。 */
export interface MarkdownEditorPreferences {
  autoSave: boolean;
  defaultMode: MarkdownEditorMode;
  showOutline: boolean;
  showBacklinks: boolean;
  showFrontmatter: boolean;
  warnOnClose: boolean;
  /** 字号（rem）。 */
  fontSize: number;
}

export const DEFAULT_PREFERENCES: MarkdownEditorPreferences = {
  autoSave: false,
  defaultMode: 'visual',
  showOutline: true,
  showBacklinks: true,
  showFrontmatter: true,
  warnOnClose: true,
  fontSize: 1.0,
};
