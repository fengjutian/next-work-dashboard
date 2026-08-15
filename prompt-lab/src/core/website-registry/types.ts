export interface WebsiteCategory {
  id: string;
  name: string;
  color: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface WebsiteRecord {
  id: string;
  name: string;
  url: string;
  normalizedUrl: string;
  description: string;
  categoryId: string | null;
  tags: string[];
  notes: string;
  faviconUrl: string | null;
  favorite: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  openCount: number;
}

export interface WebsiteRecordInput {
  name: string;
  url: string;
  description?: string;
  categoryId?: string | null;
  tags?: string[];
  notes?: string;
  faviconUrl?: string | null;
  favorite?: boolean;
  archived?: boolean;
}

export interface WebsiteRecordFilters {
  query?: string;
  categoryId?: string | null;
  favorite?: boolean;
  archived?: boolean;
  sort?: 'updated' | 'opened' | 'popular' | 'name';
}

export interface WebsiteImportPreview {
  valid: WebsiteRecordInput[];
  invalid: Array<{ row: number; reason: string }>;
  duplicateUrls: string[];
}
