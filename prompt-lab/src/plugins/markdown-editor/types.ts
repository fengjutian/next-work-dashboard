/**
 * 类型定义 — markdown-editor 插件的内部数据契约。
 *
 * 设计目标：
 *  1. 业务组件只依赖本文件，不直接 import @tiptap/*。
 *  2. Markdown 文档、文件 IO、编辑器模式分离，便于测试和未来替换 codec。
 *  3. 所有时间戳与版本号都是单调可比较的 number，避免 Date 序列化问题。
 */
import type { WorkspaceEncoding } from '@/types/electron';

// ── 基础类型 ──

export type EditorMode = 'wysiwyg' | 'source';
export type LineEnding = 'lf' | 'crlf';
export type MarkdownEncoding = WorkspaceEncoding;
export type SourceModeReason = 'unsupported' | 'too-large' | 'mixed-line-endings' | 'user-toggle' | null;

export interface FrontmatterAttributes {
  /** 原始 YAML 文本（包含 --- 标记外的所有内容），原样回填 */
  raw: string;
  /** 解析后的属性，仅用于 UI 展示，保存时不依赖它 */
  attributes: Record<string, unknown>;
  /** frontmatter 之后正文起始偏移（字符数） */
  bodyOffset: number;
  /** 是否有 frontmatter 块 */
  present: boolean;
}

// ── 文档模型 ──

export interface MarkdownDocument {
  id: string;
  rootPath: string;
  relativePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  /** savedContent 的简单 hash，用于在未修改后做快速对比 */
  savedHash: string;
  version: number;
  modifiedAt: number;
  savedAt: number;
  encoding: MarkdownEncoding;
  lineEnding: LineEnding;
  mixedLineEndings: boolean;
  readOnly: boolean;
  size: number;
  frontmatter: FrontmatterAttributes;
  body: string;
  mode: EditorMode;
  dirty: boolean;
  /** 打开时检测到的强制源码模式原因 */
  sourceModeReason: SourceModeReason;
  /** 外部文件发生变化（仍以本地版本为最新） */
  externalChange: ExternalChangeNotice | null;
  /** 最近一次往返安全检查 */
  roundtrip: RoundtripReport;
}

export interface ExternalChangeNotice {
  type: 'change' | 'rename';
  detectedAt: number;
  incomingContent: string;
  incomingModifiedAt: number;
  /** 本地已应用的版本号；如果本地还没保存到该版本 */
  localVersion: number;
}

// ── 往返安全检查 ──

export type RoundtripSeverity = 'safe' | 'lossy' | 'unsafe';

export interface RoundtripIssue {
  /** 问题简短描述 */
  message: string;
  /** 严重程度（safe=可忽略，lossy=可能影响显示，unsafe=必须降级源码） */
  severity: RoundtripSeverity;
  /** 受影响的近似行号（1-based），可选 */
  line?: number;
}

export interface RoundtripReport {
  severity: RoundtripSeverity;
  issues: RoundtripIssue[];
  /** parse → serialize → parse 后的差异行数（粗略） */
  diffLines: number;
  /** 检测时间 */
  checkedAt: number;
}

// ── 文件 IO 结果 ──

export interface SaveResult {
  success: boolean;
  version: number;
  modifiedAt: number;
  size: number;
  /** 失败时给出可读错误 */
  error?: string;
  /** 失败时如果是因为外部已修改，会带回最新内容供 UI 决定 */
  externalContent?: string;
}

// ── 事件总线 ──

export type MarkdownEvent =
  | { kind: 'opened'; document: MarkdownDocument }
  | { kind: 'closed'; id: string }
  | { kind: 'activated'; id: string }
  | { kind: 'saved'; id: string; result: SaveResult }
  | { kind: 'external-change'; id: string; incomingContent: string; incomingModifiedAt: number }
  | { kind: 'dirty-changed'; id: string; dirty: boolean }
  | { kind: 'mode-changed'; id: string; mode: EditorMode; reason: SourceModeReason }
  | { kind: 'roundtrip'; id: string; report: RoundtripReport };

// ── 设置 ──

export interface MarkdownEditorSettings {
  /** 默认接管 .md/.markdown 文件；关闭时让 code-editor 处理 */
  handleMarkdownFiles: boolean;
  /** 源码模式默认（force-on = 始终源码） */
  defaultSourceMode: boolean;
  /** 自动保存（停止输入 1.5s 后） */
  autoSave: boolean;
  /** 源码模式使用纯文本 textarea（true）还是 Monaco（false，目前 P0 永远 true） */
  useSimpleSourceEditor: boolean;
}

export const DEFAULT_MARKDOWN_EDITOR_SETTINGS: MarkdownEditorSettings = {
  handleMarkdownFiles: true,
  defaultSourceMode: false,
  autoSave: false,
  useSimpleSourceEditor: true,
};

// ── 工具常量 ──

/** 自动保存去抖延迟（ms） */
export const AUTO_SAVE_DEBOUNCE_MS = 1500;

/** 文件大小超过此阈值时进入源码模式以保护性能 */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;
