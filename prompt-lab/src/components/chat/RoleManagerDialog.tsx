import React, { useState } from 'react';
import { useStore } from '@/store';
import { listTools } from '@/core/tools';
import { Bot, Plus, X, Trash2, Settings, ChevronDown } from '@/components/icons';
import type { Role } from '@/store/types';

/**
 * 角色 Agent 管理弹层
 *
 * 功能：
 *  - 查看所有角色
 *  - 创建/编辑/删除角色
 *  - 为角色选择允许使用的工具权限
 *  - 激活角色（应用到当前对话）
 */
export const RoleManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const roles = useStore((s) => s.roles);
  const activeRoleId = useStore((s) => s.activeRoleId);
  const addRole = useStore((s) => s.addRole);
  const updateRole = useStore((s) => s.updateRole);
  const deleteRole = useStore((s) => s.deleteRole);
  const setActiveRole = useStore((s) => s.setActiveRole);

  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editTools, setEditTools] = useState<string[]>([]);

  if (!open) return null;

  const allTools = listTools();

  const startEdit = (role: Role) => {
    setEditingRoleId(role.id);
    setEditName(role.name);
    setEditDesc(role.description);
    setEditPrompt(role.systemPrompt);
    setEditTools([...role.enabledToolIds]);
  };

  const startNew = () => {
    const id = `role-${Date.now()}`;
    setEditingRoleId(id);
    setEditName('');
    setEditDesc('');
    setEditPrompt('');
    setEditTools([]);
  };

  const saveEdit = () => {
    if (!editName.trim()) return;
    const existing = roles.find((r) => r.id === editingRoleId);
    const now = Date.now();
    if (existing) {
      updateRole(editingRoleId!, {
        name: editName.trim(),
        description: editDesc.trim(),
        systemPrompt: editPrompt.trim(),
        enabledToolIds: editTools,
      });
    } else {
      addRole({
        id: editingRoleId!,
        name: editName.trim(),
        description: editDesc.trim(),
        systemPrompt: editPrompt.trim(),
        enabledToolIds: editTools,
        createdAt: now,
        updatedAt: now,
      });
    }
    setEditingRoleId(null);
  };

  const cancelEdit = () => setEditingRoleId(null);

  const toggleEditTool = (toolName: string) => {
    setEditTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName],
    );
  };

  // 工具图标映射
  const toolIcons: Record<string, string> = {
    get_current_time: '🕐', calculator: '🔢', web_search: '🔍',
    read_file: '📄', clipboard_read: '📋', fetch_url: '🌐',
    write_file: '💾', list_files: '📁', read_file_content: '📃',
    read_pdf_document: '📕', read_word_document: '📘',
    read_excel_spreadsheet: '📊', read_ppt_presentation: '📙', open_image: '🖼️',
  };

  const editingRole = editingRoleId
    ? roles.find((r) => r.id === editingRoleId)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <Bot className="h-5 w-5 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              角色 Agent 管理
            </h2>
            <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
              {roles.length} 个角色
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors"
            >
              <Plus className="h-3 w-3" />
              新建角色
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {editingRoleId ? (
            /* ── 编辑/新建表单 ── */
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase mb-1 block">角色名称</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="例如：代码审查专家"
                  className="w-full text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase mb-1 block">描述</label>
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="简要描述角色的职责范围"
                  className="w-full text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase mb-1 block">系统提示词</label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={5}
                  placeholder="定义角色的行为、风格、知识边界..."
                  className="w-full text-xs rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase mb-1 block">
                  工具权限 {editTools.length > 0 ? `（已选 ${editTools.length} 个）` : '（允许全部）'}
                </label>
                <p className="text-[10px] text-zinc-400 mb-2">勾选的工具角色可用，不勾选表示允许全部</p>
                <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
                  {allTools.map((tool) => {
                    const selected = editTools.length === 0 || editTools.includes(tool.name);
                    const icon = toolIcons[tool.name] || '🔧';
                    return (
                      <label
                        key={tool.name}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                          selected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-700/30'
                            : 'bg-zinc-50 dark:bg-zinc-800/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleEditTool(tool.name)}
                          className="rounded border-zinc-300 dark:border-zinc-600 text-blue-500 focus:ring-blue-500/50"
                        />
                        <span>{icon}</span>
                        <span className="truncate text-zinc-600 dark:text-zinc-400">{tool.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={saveEdit}
                  className="px-3 py-1.5 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  {editingRole ? '保存修改' : '创建角色'}
                </button>
              </div>
            </div>
          ) : (
            /* ── 角色列表 ── */
            <div className="space-y-2">
              {roles.map((role) => {
                const isActive = role.id === activeRoleId;
                const toolCount = role.enabledToolIds.length;
                return (
                  <div
                    key={role.id}
                    className={`rounded-lg border transition-colors ${
                      isActive
                        ? 'border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/10'
                        : 'border-transparent bg-zinc-50 dark:bg-zinc-800/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-start gap-3 px-4 py-3">
                      <Bot className={`h-5 w-5 mt-0.5 ${isActive ? 'text-blue-500' : 'text-zinc-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{role.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                              当前角色
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{role.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-zinc-400">
                            {toolCount > 0 ? `🛠️ ${toolCount} 个工具` : '🛠️ 全部工具'}
                          </span>
                          {role.systemPrompt && (
                            <span className="text-[10px] text-zinc-400 truncate max-w-[200px]">
                              📝 {role.systemPrompt.slice(0, 60)}{role.systemPrompt.length > 60 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setActiveRole(isActive ? null : role.id);
                            if (!isActive) onClose();
                          }}
                          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                            isActive
                              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {isActive ? '停用' : '启用'}
                        </button>
                        <button
                          onClick={() => startEdit(role)}
                          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-600"
                          title="编辑角色"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`确认删除角色"${role.name}"？`)) {
                              deleteRole(role.id);
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-zinc-400 hover:text-red-500"
                          title="删除角色"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-3 border-t text-[10px] text-zinc-400 shrink-0">
          启用角色后，其系统提示词会自动填充到对话，工具权限自动生效。停用角色则恢复默认。
        </div>
      </div>
    </div>
  );
};
