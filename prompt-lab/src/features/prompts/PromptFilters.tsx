import React from 'react';
import { Search, X } from '@/components/icons';

interface PromptFiltersProps {
  search: string;
  category: string | null;
  tag: string | null;
  categories: string[];
  tags: string[];
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string | null) => void;
  onTagChange: (value: string | null) => void;
  compact?: boolean;
}

export const PromptFilters: React.FC<PromptFiltersProps> = ({
  search, category, tag, categories, tags,
  onSearchChange, onCategoryChange, onTagChange, compact = false,
}) => {
  const hasFilters = Boolean(search || category || tag);
  return (
    <div className={compact ? 'space-y-2 px-3 py-2' : 'space-y-3 p-3'}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 ring-ring"
          placeholder="搜索标题、正文、分类或标签…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onSearchChange('')}
            aria-label="清空搜索"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <FilterChip active={!category} onClick={() => onCategoryChange(null)}>全部</FilterChip>
        {categories.map((item) => (
          <FilterChip key={item} active={category === item} onClick={() => onCategoryChange(category === item ? null : item)}>
            {item}
          </FilterChip>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((item) => (
            <FilterChip key={item} active={tag === item} secondary onClick={() => onTagChange(tag === item ? null : item)}>
              #{item}
            </FilterChip>
          ))}
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-primary"
          onClick={() => { onSearchChange(''); onCategoryChange(null); onTagChange(null); }}
        >
          清除筛选
        </button>
      )}
    </div>
  );
};

const FilterChip: React.FC<React.PropsWithChildren<{
  active: boolean;
  secondary?: boolean;
  onClick: () => void;
}>> = ({ active, secondary, onClick, children }) => (
  <button
    type="button"
    className={`${secondary ? 'text-[9px]' : 'text-[10px]'} rounded-full border px-2 py-0.5 transition-colors ${
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-transparent bg-muted text-muted-foreground hover:border-primary/30 hover:text-foreground'
    }`}
    onClick={onClick}
  >
    {children}
  </button>
);
