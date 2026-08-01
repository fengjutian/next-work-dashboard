import type {
  WorkspaceEncoding,
  WorkspaceEntry,
  WorkspaceGitStatus,
  WorkspaceSearchResult,
} from '@/types/electron';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface OpenDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
  standalone?: boolean;
  encoding: WorkspaceEncoding;
  lineEnding: 'LF' | 'CRLF';
  mixedLineEndings?: boolean;
  modifiedAt?: number;
  externalChanged?: boolean;
  readOnly?: boolean;
  pinned?: boolean;
  missing?: boolean;
}

export interface TreeNode extends WorkspaceEntry {
  children?: TreeNode[];
  loading?: boolean;
}

export interface TreeEditState {
  mode: 'create-file' | 'create-directory' | 'rename';
  value: string;
  target?: TreeNode;
}

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'off' | 'on';
  minimap: boolean;
  formatOnSave: boolean;
}

export interface EditorProblem {
  path: string;
  message: string;
  line: number;
  column: number;
  severity: monaco.MarkerSeverity;
}

export interface EditorSymbol {
  name: string;
  detail?: string;
  line: number;
  column: number;
  depth: number;
}

export type BottomPanelTab = 'problems' | 'output' | 'terminal' | 'outline' | 'sourceControl' | 'ai' | 'settings';

export const DEFAULT_PREFERENCES: EditorPreferences = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: 'off',
  minimap: true,
  formatOnSave: false,
};

export const errorMessages: Record<string, string> = {
  ACCESS_DENIED: '路径不在当前工作区内',
  BINARY_FILE: '二进制文件无法在代码编辑器中打开',
  FILE_TOO_LARGE: '文件超过 20MB，请使用其他工具打开',
  FILE_READ_ONLY: '文件为只读，无法保存',
  FILE_MODIFIED_EXTERNALLY: '文件已在外部修改，请重新加载或确认覆盖',
  NOT_A_FILE: '目标不是文件',
  NOT_A_DIRECTORY: '目标不是目录',
  ALREADY_EXISTS: '同名文件或文件夹已经存在',
  ENOENT: '文件或文件夹不存在',
};

export function displayError(error?: string): string {
  return errorMessages[error ?? ''] ?? error ?? '操作失败';
}

export function encodingLabel(encoding: WorkspaceEncoding): string {
  const labels: Record<WorkspaceEncoding, string> = {
    utf8: 'UTF-8',
    utf8bom: 'UTF-8 with BOM',
    utf16le: 'UTF-16 LE',
    utf16be: 'UTF-16 BE',
    gbk: 'GBK',
  };
  return labels[encoding];
}

export interface AiHunk {
  index: number;
  originalStart: number;
  originalLines: string[];
  modifiedStart: number;
  modifiedLines: string[];
}
