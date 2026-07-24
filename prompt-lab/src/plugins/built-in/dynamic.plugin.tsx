import React from 'react';
import { PluginSandbox } from '../sandbox';
import type { PluginPermission } from '../sandbox/types';

/**
 * DynamicPlugin — 用户自定义插件的通用渲染组件。
 *
 * 支持两种模式：
 *  1. 旧版 content 模式（向后兼容）：渲染 Markdown 文本
 *  2. 新版 script 模式：通过 PluginSandbox 运行用户脚本
 *
 * 当 script 非空时优先使用 sandbox 模式。
 */
interface DynamicPluginProps {
  pluginName: string;
  /** 旧版：Markdown 内容（向后兼容） */
  content?: string;
  /** 新版：JavaScript 脚本 */
  script?: string;
  /** 新版：自定义 CSS */
  style?: string;
  /** 新版：插件 ID（用于存储隔离） */
  pluginId?: string;
  /** 新版：权限声明（默认最小权限） */
  permissions?: PluginPermission[];
}

export const DynamicPlugin: React.FC<DynamicPluginProps> = ({
  pluginName,
  content,
  script,
  style,
  pluginId,
  permissions = [],
}) => {
  // ── 新版：沙箱模式 ──
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

  // ── 旧版：静态 Markdown 渲染 ──
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
