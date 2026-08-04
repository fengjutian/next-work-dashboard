import React, { useState, useEffect } from 'react';
import { Wrench, X } from '@/components/icons';
import { listTools, isToolEnabled, setToolEnabled, syncMcpTools } from '@/core/tools';
import type { ToolDefinition } from '@/core/tools';
import type { McpServerStatus } from '@/types/mcp';

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
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [mcpForm, setMcpForm] = useState({ id: '', name: '', command: '', args: '[]' });
  const [mcpError, setMcpError] = useState('');

  const refreshTools = () => {
    const allTools = listTools();
    setTools(allTools);
    setEnabledState(Object.fromEntries(allTools.map((tool) => [tool.name, isToolEnabled(tool.name)])));
  };

  const refreshServers = async () => setServers(await window.electronAPI.mcp.listServers());

  // 加载工具列表和启用状态
  useEffect(() => {
    if (open) {
      refreshTools();
      void refreshServers();
    }
  }, [open]);

  if (!open) return null;

  const toggleTool = (name: string) => {
    const newVal = !enabledState[name];
    setEnabledState((prev) => ({ ...prev, [name]: newVal }));
    setToolEnabled(name, newVal);
  };

  const saveMcpServer = async () => {
    setMcpError('');
    try {
      const args = JSON.parse(mcpForm.args) as unknown;
      if (!Array.isArray(args) || !args.every((item) => typeof item === 'string')) throw new Error('参数必须是 JSON 字符串数组');
      const saved = await window.electronAPI.mcp.saveServer({
        id: mcpForm.id,
        name: mcpForm.name,
        transport: 'stdio',
        command: mcpForm.command,
        args,
        autoConnect: true,
      });
      if (!saved.success) throw new Error(saved.error);
      const connected = await window.electronAPI.mcp.connect(mcpForm.id);
      if (!connected.success) throw new Error(connected.error);
      await syncMcpTools(false);
      refreshTools();
      await refreshServers();
      setMcpForm({ id: '', name: '', command: '', args: '[]' });
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
      await refreshServers();
    }
  };

  const toggleMcpServer = async (server: McpServerStatus) => {
    const result = server.state === 'connected'
      ? await window.electronAPI.mcp.disconnect(server.config.id)
      : await window.electronAPI.mcp.connect(server.config.id);
    if (!result.success) setMcpError(result.error ?? 'MCP 操作失败');
    await syncMcpTools(false);
    refreshTools();
    await refreshServers();
  };

  const removeMcpServer = async (serverId: string) => {
    await window.electronAPI.mcp.removeServer(serverId);
    await syncMcpTools(false);
    refreshTools();
    await refreshServers();
  };

  // 工具分组
  const builtInTools = tools.filter(
    (t) => !t.name.startsWith('mcp__') && !t.name.startsWith('read_') && t.name !== 'open_image' && t.name !== 'read_file_content',
  );
  const previewTools = tools.filter(
    (t) => !t.name.startsWith('mcp__') && (t.name.startsWith('read_') || t.name === 'open_image' || t.name === 'read_file_content'),
  );
  const mcpTools = tools.filter((tool) => tool.name.startsWith('mcp__'));

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
          <div className="rounded-lg border p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground">MCP Server（stdio）</h3>
            {servers.map((server) => (
              <div key={server.config.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${server.state === 'connected' ? 'bg-success' : server.state === 'error' ? 'bg-destructive' : 'bg-muted-foreground'}`} />
                <span className="flex-1 truncate" title={server.error}>{server.config.name} · {server.toolCount} tools</span>
                <button className="text-primary hover:underline" onClick={() => void toggleMcpServer(server)}>
                  {server.state === 'connected' ? '断开' : '连接'}
                </button>
                <button className="text-destructive hover:underline" onClick={() => void removeMcpServer(server.config.id)}>删除</button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="ID，例如 filesystem" value={mcpForm.id} onChange={(event) => setMcpForm({ ...mcpForm, id: event.target.value })} />
              <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="显示名称" value={mcpForm.name} onChange={(event) => setMcpForm({ ...mcpForm, name: event.target.value })} />
              <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="命令，例如 npx" value={mcpForm.command} onChange={(event) => setMcpForm({ ...mcpForm, command: event.target.value })} />
              <input className="rounded border bg-background px-2 py-1 text-xs font-mono" placeholder='参数 JSON，例如 ["-y","server"]' value={mcpForm.args} onChange={(event) => setMcpForm({ ...mcpForm, args: event.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-destructive">{mcpError}</span>
              <button className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50" disabled={!mcpForm.id || !mcpForm.name || !mcpForm.command} onClick={() => void saveMcpServer()}>添加并连接</button>
            </div>
          </div>

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
          {mcpTools.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                MCP 工具
              </h3>
              <div className="space-y-1">
                {mcpTools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} enabled={enabledState[tool.name] ?? true} onToggle={toggleTool} />
                ))}
              </div>
            </div>
          )}

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
  const paramNames = Object.keys(tool.parameters.properties ?? {});
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
              ? 'bg-success/10 bg-success/10 text-success text-success'
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
