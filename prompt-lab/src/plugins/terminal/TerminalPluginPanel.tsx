/**
 * 内置终端插件 — 对标 VS Code 集成终端（全功能版）。
 *
 * 功能：
 *   - 多 Tab 终端管理（新建/切换/关闭/重命名）
 *   - Tab 栏 + 工具栏
 *   - 进程重启
 *   - 右键上下文菜单
 *   - 状态指示
 *   - 键盘快捷键 (Ctrl+`)
 *   - 终端配置 (profiles)
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { TerminalSingle, TerminalHandle, TerminalTab, TerminalProfile } from './Terminal';
import { Plus, X, RefreshCw, Terminal as TerminalIcon, ChevronDown } from '@/components/icons';
import { useStore } from '@/store';

// ═══════════════════════════════════════
// 终端配置 (P6)
// ═══════════════════════════════════════

/** 浏览器环境平台检测 */
function isWindows(): boolean {
  return navigator.userAgent.includes('Win');
}

/** 获取平台默认 profiles */
function getDefaultProfiles(): TerminalProfile[] {
  if (isWindows()) {
    return [
      { name: 'PowerShell', shell: 'powershell.exe' },
      { name: 'cmd', shell: 'cmd.exe' },
      { name: 'Git Bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['-i'] },
    ];
  }
  return [
    { name: 'zsh', shell: '/bin/zsh' },
    { name: 'bash', shell: '/bin/bash' },
    { name: 'fish', shell: '/usr/bin/fish' },
  ];
}

let tabCounter = 1;

// ═══════════════════════════════════════
// Context Menu State (P9)
// ═══════════════════════════════════════

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

// ═══════════════════════════════════════
// Terminal Plugin Panel
// ═══════════════════════════════════════

export const TerminalPluginPanel: React.FC = () => {
  const { theme } = useStore();
  const appTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'default', title: 'Terminal', alive: true },
  ]);
  const [activeId, setActiveId] = useState('default');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [profileMenu, setProfileMenu] = useState<{ open: boolean }>({ open: false });
  const handlesRef = useRef<Map<string, TerminalHandle>>(new Map());

  const profiles = useMemo(() => getDefaultProfiles(), []);
  const activeTab = tabs.find(t => t.id === activeId);

  // ── Tab 操作 ──

  const newTab = useCallback((profile?: TerminalProfile) => {
    const id = `term-${tabCounter++}`;
    const label = profile?.name ?? 'Terminal';
    setTabs(prev => [...prev, { id, title: label, alive: true }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const rest = prev.filter(t => t.id !== id);
      if (rest.length === 0) return prev; // 保留最后一个
      if (activeId === id) {
        const idx = prev.findIndex(t => t.id === id);
        const newActive = rest[Math.min(idx, rest.length - 1)];
        setActiveId(newActive?.id ?? rest[0]?.id);
      }
      return rest;
    });
    handlesRef.current.delete(id);
  }, [activeId]);

  const restartTab = useCallback((id: string) => {
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, alive: true, exitCode: undefined, title: 'Terminal' } : t,
    ));
    // 通过 key 变化触发 TerminalSingle 重新 mount
    const current = tabs.find(t => t.id === id);
    if (current) {
      // 先标记不存活再恢复
      setTabs(prev => prev.map(t =>
        t.id === id ? { ...t, alive: false } : t,
      ));
      setTimeout(() => {
        setTabs(prev => prev.map(t =>
          t.id === id ? { ...t, alive: true, exitCode: undefined } : t,
        ));
      }, 50);
    }
  }, [tabs]);

  const renameTab = useCallback((id: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t));
  }, []);

  const handleExit = useCallback((id: string, exitCode: number) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, alive: false, exitCode } : t));
  }, []);

  // ── 右键菜单 ──

  const onContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ── 全局快捷键 Ctrl+` ──

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        // 切换终端面板显示（通过 activeActivity）
        const { activeActivity, setActiveActivity } = useStore.getState();
        setActiveActivity(activeActivity === 'terminal' ? null : 'terminal');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 设置 handle ──

  const setHandle = useCallback((id: string, handle: TerminalHandle) => {
    handlesRef.current.set(id, handle);
  }, []);

  // ── 渲染 ──

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background" onContextMenu={e => {
      // 空白区域右键 — 新建终端
      if ((e.target as HTMLElement).closest('.terminal-tab-bar,.terminal-toolbar')) return;
      e.preventDefault();
    }}>
      {/* Tab 栏 + 工具栏 P1/P2/P8 */}
      <div className="terminal-tab-bar flex items-center h-9 bg-muted border-b border-border select-none overflow-x-auto">
        {/* 标签页 */}
        <div className="flex items-center flex-1 min-w-0 gap-0.5 px-1">
          {tabs.map(tab => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-t-md cursor-pointer text-xs min-w-0 max-w-[180px] transition-colors ${
                  isActive
                    ? 'bg-background text-foreground border-t border-l border-r border-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
                onClick={() => setActiveId(tab.id)}
                onDoubleClick={() => {
                  const name = prompt('Rename terminal:', tab.title);
                  if (name) renameTab(tab.id, name);
                }}
                onContextMenu={e => onContextMenu(e, tab.id)}
                title={`${tab.title}${!tab.alive ? ' (dead)' : ''}`}
              >
                <TerminalIcon className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{tab.title}</span>
                {!tab.alive && (
                  <span className="text-destructive text-[10px] flex-shrink-0">×</span>
                )}
                <button
                  className="flex-shrink-0 opacity-0 hover:opacity-100 hover:bg-accent rounded-sm p-0.5 group-hover:opacity-100 transition-opacity ml-0.5"
                  onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                  title="Close"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* 工具栏 P8 */}
        <div className="terminal-toolbar flex items-center gap-0.5 px-2 flex-shrink-0">
          {/* + 新建（带 profile 下拉） */}
          <div className="relative">
            <button
              className="flex items-center gap-0.5 px-1.5 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => newTab()}
              title="New Terminal"
            >
              <Plus className="h-3.5 w-3.5" />
              <span
                className="h-2.5 w-2.5 cursor-pointer"
                onClick={e => { e.stopPropagation(); setProfileMenu({ open: !profileMenu.open }); }}
              >
                <ChevronDown className="h-2.5 w-2.5" />
              </span>
            </button>
            {profileMenu.open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProfileMenu({ open: false })} />
                <div className="absolute right-0 top-full mt-0.5 z-20 bg-muted border border-border rounded-md shadow-xl py-1 min-w-[140px]">
                  {profiles.map(p => (
                    <button
                      key={p.name}
                      className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => { newTab(p); setProfileMenu({ open: false }); }}
                    >
                      {p.shell.split('/').pop()?.split('\\').pop()} — {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 重启 */}
          {activeTab && !activeTab.alive && (
            <button
              className="px-1.5 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => restartTab(activeTab.id)}
              title="Restart Terminal"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}

          {/* 关闭 */}
          {tabs.length > 1 && activeTab && (
            <button
              className="px-1.5 py-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => closeTab(activeTab.id)}
              title="Kill Terminal"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 终端面板区 */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map(tab => (
          <div
            key={`${tab.id}-${tab.alive ? 'alive' : 'dead'}`}
            className="absolute inset-0"
            style={{ display: tab.id === activeId ? 'block' : 'none' }}
          >
            {tab.alive ? (
              <TerminalSingle
                id={tab.id}
                title={tab.title}
                cwd={tab.cwd}
                alive={tab.alive}
                theme={appTheme as 'dark' | 'light'}
                onTitleChange={renameTab}
                onExit={handleExit}
                setHandle={(h) => setHandle(tab.id, h)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground gap-3">
                <TerminalIcon className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm">
                  Process exited with code {tab.exitCode ?? 'unknown'}
                </p>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-xs bg-accent hover:bg-accent/80 text-foreground rounded-md transition-colors"
                    onClick={() => restartTab(tab.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 inline mr-1" />
                    Restart
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs bg-accent hover:bg-accent/80 text-foreground rounded-md transition-colors"
                    onClick={() => closeTab(tab.id)}
                  >
                    <X className="h-3.5 w-3.5 inline mr-1" />
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 状态栏 P11 */}
      <div className="flex items-center h-6 px-3 bg-muted border-t border-border text-[11px] text-muted-foreground select-none gap-3">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${activeTab?.alive ? 'bg-success' : 'bg-destructive'}`} />
          {activeTab?.alive ? 'Running' : `Exited (${activeTab?.exitCode})`}
        </span>
        <span className="text-muted-foreground">|</span>
        <span>{activeTab?.id ?? '—'}</span>
        {tabs.length > 1 && (
          <>
            <span className="text-muted-foreground">|</span>
            <span>{tabs.length} terminals</span>
          </>
        )}
        <div className="flex-1" />
        <span>Ctrl+Shift+C/V Copy/Paste</span>
      </div>

      {/* 右键菜单 P9 */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeContextMenu} />
          <div
            className="fixed z-40 bg-muted border border-border rounded-md shadow-xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              onClick={() => { newTab(); closeContextMenu(); }}
            >
              <Plus className="h-3 w-3 inline mr-2" />New Terminal
            </button>
            <button
              className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              onClick={() => { restartTab(contextMenu.tabId); closeContextMenu(); }}
            >
              <RefreshCw className="h-3 w-3 inline mr-2" />Restart
            </button>
            <div className="border-t border-border my-1" />
            <button
              className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              onClick={() => { closeTab(contextMenu.tabId); closeContextMenu(); }}
            >
              <X className="h-3 w-3 inline mr-2" />Kill Terminal
            </button>
          </div>
        </>
      )}
    </div>
  );
};
