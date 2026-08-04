import React from 'react';
import { PluginSandbox } from '../sandbox';
import type { PluginPermission } from '../sandbox/types';

interface DynamicPluginProps {
  pluginName: string;
  content?: string;
  script?: string;
  style?: string;
  pluginId?: string;
  permissions?: PluginPermission[];
}

/** User code only runs through PluginSandbox. Static content remains for legacy plugins. */
export const DynamicPlugin: React.FC<DynamicPluginProps> = ({
  pluginName,
  content,
  script,
  style,
  pluginId,
  permissions = [],
}) => {
  if (script) {
    return (
      <PluginSandbox
        pluginId={pluginId ?? pluginName}
        script={script}
        style={style}
        permissions={permissions}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="font-semibold text-sm text-foreground">{pluginName}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {content ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br/>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline">$1</a>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>'),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-16">空白插件</p>
        )}
      </div>
    </div>
  );
};
