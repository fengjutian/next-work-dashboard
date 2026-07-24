import React from 'react';

/**
 * DynamicPlugin — 用户自定义插件的通用渲染组件。
 *
 * 用户在插件管理器中输入的内容（支持 Markdown）由此组件渲染。
 * 用作自定义插件的 component 字段。
 */
interface DynamicPluginProps {
  pluginName: string;
  content: string;
}

export const DynamicPlugin: React.FC<DynamicPluginProps> = ({ pluginName, content }) => {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="px-4 py-3 border-b">
        <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
          {pluginName}
        </h2>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {content ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br/>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline">$1</a>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code class="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-xs">$1</code>'),
            }}
          />
        ) : (
          <p className="text-sm text-zinc-400 text-center py-16">
            空白插件 — 可在插件管理中编辑内容
          </p>
        )}
      </div>
    </div>
  );
};
