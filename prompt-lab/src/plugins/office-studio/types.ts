export type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx';

export interface OfficeCliStatus {
  available: boolean;
  version?: string;
  executable?: string;
  bundled: boolean;
  error?: string;
}

export interface OfficeOperationResult {
  success: boolean;
  output?: string;
  error?: string;
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface OfficeRenderResult extends OfficeOperationResult {
  html?: string;
}

export interface OfficeCreateResult extends OfficeOperationResult {
  filePath?: string;
}

export interface OfficeSetRequest { filePath: string; path: string; properties: Record<string, string> }
export interface OfficeAddRequest extends OfficeSetRequest { type: string; index?: number }

export interface OfficeStudioAPI {
  status(): Promise<OfficeCliStatus>;
  create(kind: OfficeDocumentKind): Promise<OfficeCreateResult>;
  outline(filePath: string): Promise<OfficeOperationResult>;
  get(filePath: string, path: string, depth?: number): Promise<OfficeOperationResult>;
  query(filePath: string, selector: string): Promise<OfficeOperationResult>;
  set(request: OfficeSetRequest): Promise<OfficeOperationResult>;
  add(request: OfficeAddRequest): Promise<OfficeOperationResult>;
  remove(filePath: string, path: string): Promise<OfficeOperationResult>;
  save(filePath: string): Promise<OfficeOperationResult>;
  undo(filePath: string): Promise<OfficeOperationResult>;
  redo(filePath: string): Promise<OfficeOperationResult>;
  merge(filePath: string, data: Record<string, unknown>): Promise<OfficeCreateResult>;
  render(filePath: string): Promise<OfficeRenderResult>;
  close(filePath: string): Promise<OfficeOperationResult>;
}
