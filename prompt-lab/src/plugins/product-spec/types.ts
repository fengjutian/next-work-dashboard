export type ProductSpecSourceKind = 'image' | 'document' | 'code';

export interface ProductSpecSource {
  id: string;
  name: string;
  kind: ProductSpecSourceKind;
  size: number;
  text?: string;
  dataUrl?: string;
}

export interface ProductSpecOptions {
  productName: string;
  audience: string;
  additionalRequirements: string;
  includeDevelopmentPlan: boolean;
  includeAcceptanceCriteria: boolean;
}

export interface ProductSpecContext {
  sources: ProductSpecSource[];
  options: ProductSpecOptions;
}
