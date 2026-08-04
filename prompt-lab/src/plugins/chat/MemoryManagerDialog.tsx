import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Database, FileText, Plus, Trash2, Check, Search, X } from '@/components/icons';

const MANUAL_MEMORY_ENABLED_KEY = 'chat.manual-memory.enabled';

interface MemoryItem {
  path: string;
  fileName: string;
  title: string;
  size: number;
  modifiedAt: number;
  enabled: boolean;
}

export function useManualMemoryEnabled() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(MANUAL_MEMORY_ENABLED_KEY) !== 'false');
  useEffect(() => { localStorage.setItem(MANUAL_MEMORY_ENABLED_KEY, String(enabled)); }, [enabled]);
  return { manualMemoryEnabled: enabled, setManualMemoryEnabled: setEnabled };
}

/**
 * 记忆管理器弹层 — 管理手动添加的记忆
 *
 * 左侧：记忆列表（搜索过滤）
 * 右侧：编辑区（Markdown + 保存 / 删除）
 */
export const MemoryManagerDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [manualMemoryEnabled, setManualMemoryEnabled] = useState(() => localStorage.getItem(MANUAL_MEMORY_ENABLED_KEY) !== 'false');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const selectionRequest = useRef(0);

  const refreshList = useCallback(async () => {
    try {
      const memFiles = await window.electronAPI.listMemories();
      setMemories(memFiles.map((m) => ({ ...m, enabled: m.enabled !== false })));
      setError('');
    } catch (cause) {
      setError(`记忆列表读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);

  useEffect(() => {
    if (open) { refreshList(); setSelectedPath(null); setIsNew(false); }
  }, [open, refreshList]);

  // ── 选择记忆 ──
  const selectMemory = useCallback(async (item: MemoryItem) => {
    const requestId = ++selectionRequest.current;
    setSelectedPath(item.path);
    setIsNew(false);
    setEditTitle(item.title);
    const result = await window.electronAPI.readMemory(item.path);
    if (requestId !== selectionRequest.current) return;
    if (!result.success) {
      setError(`记忆读取失败：${result.error ?? '未知错误'}`);
      setEditContent('');
      return;
    }
    setError('');
    setEditContent(result.content ?? '');
  }, []);

  // ── 新建 ──
  const createNew = useCallback(() => {
    selectionRequest.current += 1;
    setSelectedPath(null);
    setIsNew(true);
    setEditTitle('');
    setEditContent('');
    setError('');
  }, []);

  // ── 保存 ──
  const handleSave = useCallback(async () => {
    if (!editTitle.trim()) { setError('请输入记忆标题'); return; }
    setSaving(true);
    try {
      const api = window.electronAPI;
      const content = `# ${editTitle.trim()}\n\n${editContent.replace(/^# .+\n\n?/, '')}`;
      if (isNew) {
        const fileName = editTitle.trim().replace(/[<>:"/\\|?*]/g, '_') + '.md';
        const result = await api.writeMemory(fileName, content);
        if (!result.success) throw new Error(result.error);
        setSelectedPath(result.filePath!);
        setIsNew(false);
      } else if (selectedPath) {
        const result = await api.writeMemory(selectedPath, content);
        if (!result.success) throw new Error(result.error);
      }
      await refreshList();
    } catch (err: any) {
      setError(`保存失败：${err.message === 'FILE_EXISTS' ? '已存在同名记忆，请修改标题' : err.message}`);
    } finally { setSaving(false); }
  }, [editTitle, editContent, isNew, selectedPath, refreshList]);

  // ── 删除 ──
  const handleDelete = useCallback(async () => {
    if (!selectedPath) return;
    const item = memories.find((m) => m.path === selectedPath);
    if (!item) return;
    if (!confirm(`确定删除「${item.title}」？此操作不可撤销。`)) return;
    try {
      const result = await window.electronAPI.deleteMemory(selectedPath);
      if (!result.success) throw new Error(result.error);
      setSelectedPath(null);
      setIsNew(false);
      setEditContent('');
      setEditTitle('');
      setError('');
      await refreshList();
    } catch (err: any) {
      setError(`删除失败：${err.message}`);
    }
  }, [selectedPath, memories, refreshList]);

  const toggleMemory = useCallback(async (item: MemoryItem) => {
    const enabled = !item.enabled;
    setMemories((current) => current.map((memory) => memory.path === item.path ? { ...memory, enabled } : memory));
    try {
      const result = await window.electronAPI.setMemoryEnabled(item.path, enabled);
      if (!result.success) throw new Error(result.error);
      setError('');
    } catch (cause) {
      setMemories((current) => current.map((memory) => memory.path === item.path ? { ...memory, enabled: item.enabled } : memory));
      setError(`启用状态保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);

  // ── 过滤 ──
  const q = searchQuery.toLowerCase();
  const filtered = q
    ? memories.filter((m) => m.title.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q))
    : memories;

  useEffect(() => { localStorage.setItem(MANUAL_MEMORY_ENABLED_KEY, String(manualMemoryEnabled)); }, [manualMemoryEnabled]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="relative flex h-[80vh] w-[80vw] overflow-hidden rounded-lg bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 左侧列表 */}
        <div className="w-56 shrink-0 border-r flex flex-col bg-background">
          <div className="px-2 py-2 border-b">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <Database className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">记忆管理</span>
              </div>
              <label className="flex items-center gap-1 cursor-pointer" title="开启后手动记忆参与 AI 检索">
                <input type="checkbox" className="h-3 w-3" checked={manualMemoryEnabled}
                  onChange={(e) => setManualMemoryEnabled(e.target.checked)} />
                <span className="text-[10px] text-muted-foreground">检索</span>
              </label>
            </div>
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                className="w-full rounded border bg-card pl-5 pr-1.5 py-1 text-[11px] outline-none focus:border-primary"
                placeholder="搜索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map((m) => (
                <div
                  key={m.path}
                  className={`flex w-full items-center gap-1 px-2 py-1.5 text-[11px] hover:bg-accent ${selectedPath === m.path ? 'bg-primary-light text-primary' : ''} ${m.enabled ? '' : 'opacity-55'}`}
                  title={m.title}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => selectMemory(m)}>
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{m.title}</span>
                  </button>
                  <label className="flex shrink-0 cursor-pointer items-center" title={m.enabled ? '停用这条记忆' : '启用这条记忆'}>
                    <input type="checkbox" className="h-3 w-3" checked={m.enabled} onChange={() => void toggleMemory(m)} aria-label={`${m.enabled ? '停用' : '启用'}${m.title}`} />
                  </label>
                </div>
              ))
            ) : (
              <div className="px-2 py-4 text-[11px] text-muted-foreground text-center">
                {searchQuery ? '无匹配记忆' : '暂无记忆，点击下方按钮新建'}
              </div>
            )}
          </div>
          <div className="px-2 py-1.5 border-t">
            <button
              className="w-full flex items-center justify-center gap-1 rounded border py-1 text-[11px] hover:bg-accent"
              onClick={createNew}
            >
              <Plus className="h-3 w-3" /> 新建记忆
            </button>
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {error && <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">{error}</div>}
          {selectedPath || isNew ? (
            <>
              <div className="flex items-center justify-between py-2 pl-3 pr-10 border-b bg-background">
                <div className="flex items-center gap-2 min-w-0">
                  {isNew ? (
                    <input
                      className="text-sm font-semibold bg-transparent border-b border-primary outline-none min-w-[120px]"
                      placeholder="输入记忆标题..."
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-semibold truncate">
                      {editTitle || '未命名'}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {isNew ? '新建' : '手动记忆'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    onClick={handleSave} disabled={saving}
                  >
                    <Check className="h-3 w-3" />{saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    onClick={handleDelete} disabled={isNew}
                  >
                    <Trash2 className="h-3 w-3" />删除
                  </button>
                </div>
              </div>
              <textarea
                className="flex-1 w-full resize-none bg-card p-3 text-sm outline-none font-mono"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="在此输入记忆内容（支持 Markdown）..."
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              选择左侧记忆或新建记忆
            </div>
          )}
        </div>

        <button
          className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          onClick={onClose}
          title="关闭"
          aria-label="关闭记忆管理"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
