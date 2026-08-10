/**
 * 公共类型定义 — markdown-editor 插件。
 *
 * 设计要点：
 *  - MarkdownDocument 是工作区内的最小文件单元（类似 Monaco 的 TextModel）。
 *  - 所有字段以磁盘上的 `.md` 为唯一事实源；编辑器状态仅在内存中派生。
 *  - 序列化/反序列化由 markdown-codec 负责，业务层不直接接触 Tiptap JSON。
 */

/** 标签页模式：可视化（WYSIWYG） vs 源码（原始 Markdown 文本） */
export type MarkdownEditorMode = 'visual' | 'source';

/** 保存状态机。`unsaved` 表示本地有改动；`saving` 表示正在写盘；`error` 表示写盘失败。 */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

/** 往返安全状态：'safe' 可视化模式；'unsafe' 必须降级源码模式。 */
export type RoundtripSafety = 'safe' | 'unsafe';

/** 文档来源。区分工作区内部、外部打开（picker）、新建。 */
export type MarkdownDocumentSource = 'workspace' | 'external' | 'new';

/** 单个打开的 Markdown 文档。 */
export interface MarkdownDocument {
  /** 唯一 ID（用作 React key）。 */
  id: string;
  /** 根目录绝对路径；外部文件（无工作区）时为 null。 */
  rootPath: string | null;
  /** 相对工作区的路径（统一使用 `/`）；外部文件时为完整路径。 */
  relativePath: string;
  /** 显示名（通常是 basename，不含扩展名）。 */
  displayName: string;
  /** 文档来源。 */
  source: MarkdownDocumentSource;
  /** 当前内存中的 Markdown 文本（已剥离 frontmatter 时不含 frontmatter 块）。 */
  content: string;
  /** 最近一次成功保存到磁盘的内容（含 frontmatter）。用于判断 dirty / 冲突。 */
  savedContent: string;
  /** 原始 frontmatter 文本（含 `---` 边界），未改动时原样回写。 */
  savedFrontmatter: string;
  /** 工作区 IPC 报告的 `modifiedAt`；保存时作为 `expectedModifiedAt` 传递以检测冲突。 */
  baseModifiedAt: number | null;
  /** 源文件的换行符风格。仅在第一次读取时确定；保存时保持不变。 */
  lineEnding: 'lf' | 'crlf';
  /** 当前是否有未保存的本地改动。 */
  dirty: boolean;
  /** 当前编辑模式。 */
  mode: MarkdownEditorMode;
  /** 文档总字符数（用于状态栏展示；UTF-16 code unit 数）。 */
  charCount: number;
  /** 文档行数。 */
  lineCount: number;
  /** 往返安全评估结果。 */
  roundtrip: RoundtripSafety;
  /** 触发降级为源码模式的原因（仅在 roundtrip === 'unsafe' 时填写）。 */
  roundtripReason?: string;
  /** 是否有内容被 roundtrip 守卫拒绝进入可视化模式（如 MDX、JSX 标签等）。 */
  hasUnsupportedBlocks: boolean;
}

/** 文档的最小持久化信息：仅存元数据 + 内容，开/关插件后能恢复最近打开的标签。 */
export interface MarkdownDocumentSnapshot {
  id: string;
  rootPath: string | null;
  relativePath: string;
  source: MarkdownDocumentSource;
  mode: MarkdownEditorMode;
  /** 文档内容（含 frontmatter），重新打开时直接加载。 */
  content: string;
  baseModifiedAt: number | null;
  lineEnding: 'lf' | 'crlf';
}

/** 保存操作的返回结果。 */
export type SaveResult =
  | { ok: true; modifiedAt: number; size: number }
  | { ok: false; reason: 'conflict'; currentContent: string; currentModifiedAt: number }
  | { ok: false; reason: 'read-only' }
  | { ok: false; reason: 'error'; message: string };

/** 打开/新建文档的统一返回。 */
export interface OpenDocumentOutcome {
  /** 文档。 */
  document: MarkdownDocument;
  /** 是新建还是已存在。 */
  isNew: boolean;
}

/** 文档事件总线事件。 */
export type MarkdownDocumentEvent =
  | { kind: 'dirty-changed'; documentId: string; dirty: boolean }
  | { kind: 'saved'; documentId: string; modifiedAt: number }
  | { kind: 'save-failed'; documentId: string; reason: string }
  | { kind: 'external-change'; documentId: string; path: string }
  | { kind: 'closed'; documentId: string };
