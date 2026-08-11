/**
 * 插件入口：与 code-editor 保持同样的 stable 边界。
 * 业务实现全部下沉到 MarkdownEditorPanel。
 */
export { MarkdownEditorPanel } from './MarkdownEditorPanel';
export { PLUGIN_ID, FILE_EDITOR_ID, FILE_EDITOR_VIEW_ID, SUPPORTED_EXTENSIONS, DEFAULT_PREFERENCES } from './constants';
export type { MarkdownDocument, MarkdownDocumentEvent, MarkdownEditorMode, SaveResult, MarkdownDocumentSource, MarkdownDocumentSnapshot, RoundtripSafety } from './types';
export type { MarkdownEditorPreferences } from './constants';
