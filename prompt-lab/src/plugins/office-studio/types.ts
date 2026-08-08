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
}

export interface OfficeRenderResult extends OfficeOperationResult {
  html?: string;
}

export interface OfficeCreateResult extends OfficeOperationResult {
  filePath?: string;
}

export interface OfficeStudioAPI {
  status(): Promise<OfficeCliStatus>;
  create(kind: OfficeDocumentKind): Promise<OfficeCreateResult>;
  outline(filePath: string): Promise<OfficeOperationResult>;
  render(filePath: string): Promise<OfficeRenderResult>;
  close(filePath: string): Promise<OfficeOperationResult>;
}
