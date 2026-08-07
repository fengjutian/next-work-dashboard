import React, { useState } from 'react';
import { MessageSquare, X, Trash2, Globe } from '@/components/icons';
import { useStore } from '@/store';

/**
 * 技能管理器弹层
 *
 * 展示所有已导入的技能，允许用户：
 *  - 启用/禁用
 *  - 绑定到当前对话（绑定的技能自动注入到 system prompt）
 *  - 从 GitHub 导入新技能
 *  - 删除技能
 */
export const SkillManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  boundSkillIds?: string[];
  onToggleBound?: (skillId: string) => void;
}> = ({ open, onClose, boundSkillIds = [], onToggleBound }) => {
  const skills = useStore((s) => s.skills);
  const toggleSkill = useStore((s) => s.toggleSkill);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const importSkillFromGitHub = useStore((s) => s.importSkillFromGitHub);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  if (!open) return null;

  const handleImport = async () => {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportError(null);
    try {
      await importSkillFromGitHub(url);
      setImportUrl('');
    } catch (err: any) {
      setImportError(err?.message ?? '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative w-full max-w-lg max-h-[80vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h3 className="text-base font-semibold">技能管理</h3>
            <p className="text-xs text-gray-500">
              {enabledCount}/{skills.length} 已启用
            </p>
          </div>
          <button
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Import section */}
        <div className="px-4 py-3 border-b shrink-0 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); setImportError(null); }}
              placeholder="GitHub URL，如 https://github.com/jakubkrehel/oklch-skill"
              className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
            />
            <button
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
              onClick={handleImport}
              disabled={importing || !importUrl.trim()}
            >
              <Globe className="w-3.5 h-3.5" />
              {importing ? '导入中...' : '导入'}
            </button>
          </div>
          {importError && <p className="text-xs text-red-500">{importError}</p>}
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto">
          {skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <MessageSquare className="w-10 h-10 mb-2" />
              <p className="text-sm">暂无技能</p>
              <p className="text-xs mt-1">粘贴 GitHub URL 导入技能</p>
            </div>
          ) : (
            <div className="divide-y">
              {skills.map((skill) => {
                const isBound = boundSkillIds.includes(skill.id);
                return (
                  <div key={skill.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-medium truncate">{skill.name}</h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                            {skill.files.length} refs
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{skill.description}</p>
                        {skill.source && (
                          <p className="text-[10px] text-gray-400 mt-1 truncate">{skill.source}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {/* Enable/Disable toggle */}
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          onChange={() => toggleSkill(skill.id)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                        />
                        <span className="text-xs text-gray-500">启用</span>
                      </label>
                      {/* Bind toggle */}
                      {onToggleBound && (
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isBound}
                            onChange={() => onToggleBound(skill.id)}
                            disabled={!skill.enabled}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-400"
                          />
                          <span className="text-xs text-gray-500">绑定</span>
                        </label>
                      )}
                      <div className="flex-1" />
                      {/* Delete */}
                      <button
                        className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        onClick={() => {
                          if (window.confirm(`确定删除技能 "${skill.name}"？`)) {
                            deleteSkill(skill.id);
                          }
                        }}
                        title="删除技能"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
