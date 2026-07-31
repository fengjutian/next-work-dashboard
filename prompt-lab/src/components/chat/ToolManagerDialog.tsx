import React, { useState, useEffect } from 'react';
import { Wrench, X } from '@/components/icons';
import { listTools, isToolEnabled, setToolEnabled } from '@/core/tools';
import type { ToolDefinition } from '@/core/tools';

/**
 * 工具管理器弹层
 *
 * 展示所有已注册的 AI 工具，允许用户逐个启用/禁用。
 * 默认全部启用，禁用后 AI Agent 将无法调用该工具。
 */
export const ToolManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [enabledState, setEnabledState] = useState<Record<string, boolean>>({});

  // 加载工具列表和启用状态
  useEffect(() => {
    if (open) {
      const allTools = listTools();
      setTools(allTools);
      const state: Record<string, boolean> = {};
      for (const t of allTools) {
        state[t.name] = isToolEnabled(t.name);
      }
      setEnabledState(state);
    }
  }, [open]);

  if (!open) return null;

  const toggleTool = (name: string) => {
    const newVal = !enabledState[name];
    setEnabledState((prev) => ({ ...prev, [name]: newVal }));
    setToolEnabled(name, newVal);
  };

  // 工具分组
  const builtInTools = tools.filter(
    (t) => !t.name.startsWith('read_') && t.name !== 'open_image' && t.name !== 'read_file_content',
  );
  const previewTools = tools.filter(
    (t) => t.name.startsWith('read_') || t.name === 'open_image' || t.name === 'read_file_content',
  );

  const enabledCount = Object.values(enabledState).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              工具管理
            </h2>
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {enabledCount} / {tools.length} 已启用
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* 工具列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {/* 内置工具 */}
          <div>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              基础工具
            </h3>
            <div className="space-y-1">
              {builtInTools.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  enabled={enabledState[tool.name] ?? true}
                  onToggle={toggleTool}
                />
              ))}
            </div>
          </div>

          {/* 预览插件工具 */}
          {previewTools.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                文件预览工具
              </h3>
              <div className="space-y-1">
                {previewTools.map((tool) => (
                  <ToolRow
                    key={tool.name}
                    tool={tool}
                    enabled={enabledState[tool.name] ?? true}
                    onToggle={toggleTool}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 空状态 */}
          {tools.length === 0 && (
            <div className="text-center py-8">
              <Wrench className="h-10 w-10 text-foreground text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">暂无可用工具</p>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t text-[10px] text-muted-foreground shrink-0">
          禁用后，AI Agent 将无法调用该工具。所有工具默认启用。
        </div>
      </div>
    </div>
  );
};

// ── 单行工具条目 ──

const toolIcons: Record<string, string> = {
  get_current_time: '🕐',
  calculator: '🔢',
  web_search: '🔍',
  read_file: '📄',
  clipboard_read: '📋',
  fetch_url: '🌐',
  write_file: '💾',
  list_files: '📁',
  read_file_content: '📃',
  read_pdf_document: '📕',
  read_word_document: '📘',
  read_excel_spreadsheet: '📊',
  read_ppt_presentation: '📙',
  open_image: '🖼️',
};

const ToolRow: React.FC<{
  tool: ToolDefinition;
  enabled: boolean;
  onToggle: (name: string) => void;
}> = ({ tool, enabled, onToggle }) => {
  const icon = toolIcons[tool.name] || '🔧';
  const paramNames = Object.keys(tool.parameters.properties);
  const paramHint = paramNames.length > 0
    ? `参数: ${paramNames.join(', ')}`
    : '无需参数';

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        enabled
          ? 'bg-card/50 hover:bg-background dark:hover:bg-muted'
          : 'bg-background bg-muted/20 opacity-60'
      }`}
    >
      <span className="text-base shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono font-medium text-foreground">
            {tool.name}
          </code>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            enabled
              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          }`}>
            {enabled ? '已启用' : '已禁用'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
          {tool.description}
        </p>
        <p className="text-[10px] text-foreground text-muted-foreground mt-0.5">
          {paramHint}
        </p>
      </div>
      <button
        onClick={() => onToggle(tool.name)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
          enabled ? 'bg-success' : 'bg-input'
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};
