import React from 'react';
import type { Prompt } from '@/store/types';
import { getPromptPreview } from './domain';

interface PromptCardContentProps {
  prompt: Prompt;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  compact?: boolean;
  maxTags?: number;
}

export const PromptCardContent: React.FC<PromptCardContentProps> = ({
  prompt, actions, leading, compact = false, maxTags = compact ? 2 : 3,
}) => (
  <div className="flex min-w-0 items-start gap-2">
    {leading}
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <h4 className={`${compact ? 'text-sm font-medium' : 'text-sm font-semibold'} truncate text-foreground`}>
          {prompt.title}
        </h4>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      <p className={`${compact ? 'mt-1 line-clamp-2' : 'my-2 line-clamp-3'} text-xs leading-relaxed text-muted-foreground`}>
        {getPromptPreview(prompt.content, compact ? 80 : 120)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Meta>{prompt.category}</Meta>
        {prompt.tags.slice(0, maxTags).map((tag) => <Meta key={tag}>#{tag}</Meta>)}
        {prompt.tags.length > maxTags && <span className="text-[9px] text-muted-foreground">+{prompt.tags.length - maxTags}</span>}
        <span className="ml-auto text-[9px] text-muted-foreground">使用 {prompt.usageCount} 次</span>
      </div>
    </div>
  </div>
);

const Meta: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{children}</span>
);
