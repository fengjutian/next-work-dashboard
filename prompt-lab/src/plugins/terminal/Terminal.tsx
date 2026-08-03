/**
 * Terminal — xterm.js 终端组件（全功能版）。
 *
 * 对标 VS Code 集成终端：
 *   - 多 Tab 终端管理
 *   - 搜索 (Ctrl+F)
 *   - 复制/粘贴快捷键 (Ctrl+Shift+C/V)
 *   - URL 链接自动识别
 *   - Unicode 11 / 连字 / 序列化
 *   - 右键上下文菜单
 *   - 进程状态指示
 */

import React, { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SerializeAddon } from '@xterm/addon-serialize';

import '@xterm/xterm/css/xterm.css';

// ═══════════════════════════════════════
// 主题
// ═══════════════════════════════════════

const DARK_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
  brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
  brightCyan: '#29b8db', brightWhite: '#e5e5e5',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800',
  blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14',
  brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc',
  brightCyan: '#0598bc', brightWhite: '#a5a5a5',
};

// ═══════════════════════════════════════
// 类型
// ═══════════════════════════════════════

export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  alive: boolean;
  exitCode?: number;
}

export interface TerminalProfile {
  name: string;
  shell: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface TerminalHandle {
  focus: () => void;
  search: () => void;
  serialize: () => string | undefined;
}

export interface TerminalSingleProps extends TerminalTab {
  theme?: 'dark' | 'light';
  profile?: TerminalProfile;
  fontSize?: number;
  fontFamily?: string;
  onTitleChange?: (id: string, title: string) => void;
  onExit?: (id: string, exitCode: number) => void;
  setHandle?: (handle: TerminalHandle) => void;
  onOutput?: (id: string, data: string) => void;
}

// ═══════════════════════════════════════
// 单个终端实例
// ═══════════════════════════════════════

export const TerminalSingle = forwardRef<TerminalHandle, TerminalSingleProps>(
  (props, ref) => {
    const {
      id, cwd, theme = 'dark', profile, fontSize = 13,
      fontFamily = "Cascadia Code, Consolas, 'Courier New', monospace",
      onTitleChange, onExit, setHandle, onOutput,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const serializeAddonRef = useRef<SerializeAddon | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);
    const themeColors = theme === 'light' ? LIGHT_THEME : DARK_THEME;

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      focus: () => xtermRef.current?.focus(),
      search: () => {
        searchAddonRef.current?.findNext('');
      },
      serialize: () => {
        try { return serializeAddonRef.current?.serialize(); } catch { return undefined; }
      },
    }), []);

    // 初始化
    const init = useCallback(async () => {
      const container = containerRef.current;
      if (!container) return;
      xtermRef.current?.dispose();

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      const serializeAddon = new SerializeAddon();
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      serializeAddonRef.current = serializeAddon;

      const xterm = new XTerm({
        cols: 80, rows: 24,
        cursorBlink: true, cursorStyle: 'bar',
        fontSize, fontFamily,
        theme: themeColors,
        allowProposedApi: true,
        allowTransparency: false,
        scrollback: 10000,
      });

      // Addons
      try {
        const wgl = new WebglAddon();
        wgl.onContextLoss(() => wgl.dispose());
        xterm.loadAddon(wgl);
      } catch { /* canvas fallback */ }

      xterm.loadAddon(fitAddon);
      xterm.loadAddon(searchAddon);
      xterm.loadAddon(serializeAddon);
      xterm.loadAddon(new WebLinksAddon((_event, uri) => {
        window.electronAPI.shell?.openExternal?.(uri) ?? window.open(uri, '_blank');
      }));
      xterm.loadAddon(new Unicode11Addon());
      xterm.unicode.activeVersion = '11';

      try {
        xterm.loadAddon(new LigaturesAddon());
      } catch { /* ligatures not supported in this env */ }

      xterm.open(container);
      fitAddon.fit();

      // 键盘快捷键 P4 — copy/paste
      xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
          const sel = xterm.getSelection();
          if (sel) {
            e.preventDefault();
            navigator.clipboard.writeText(sel);
          }
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
          e.preventDefault();
          navigator.clipboard.readText().then(text => {
            window.electronAPI.terminal.write(id, text);
          });
          return false;
        }
        // Ctrl+F 交给 addon-search 处理
        if (e.ctrlKey && e.key === 'f') {
          e.preventDefault();
          searchAddon.findNext('');
          return false;
        }
        return true;
      });

      xtermRef.current = xterm;

      // 创建 PTY
      const result = await window.electronAPI.terminal.create(id, cwd, profile);
      if (!result.success) {
        xterm.writeln(`\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`);
        return;
      }

      const unsubData = window.electronAPI.terminal.onData(id, (data: string) => {
        onOutput?.(id, data);
        // 尝试从 OSC 标题序列提取标题
        const titleMatch = data.match(/\x1b\]0;(.+?)\x07/);
        if (titleMatch) onTitleChange?.(id, titleMatch[1]);
        xterm.write(data);
      });

      const unsubExit = window.electronAPI.terminal.onExit(id, (exitCode: number) => {
        xterm.writeln(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
        onExit?.(id, exitCode);
      });

      xterm.onData((data) => window.electronAPI.terminal.write(id, data));
      xterm.onResize(({ cols, rows }) => window.electronAPI.terminal.resize(id, cols, rows));

      cleanupRef.current = () => {
        unsubData();
        unsubExit();
      };

      // 欢迎信息
      xterm.writeln('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m');
      xterm.writeln('\x1b[1;36m║   next-work-dashboard — Terminal    ║\x1b[0m');
      xterm.writeln('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m');
      xterm.writeln('');

      setHandle?.({
        focus: () => xterm.focus(),
        search: () => searchAddon.findNext(''),
        serialize: () => { try { return serializeAddon.serialize(); } catch { return undefined; } },
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, cwd, theme, fontSize, fontFamily]);

    useEffect(() => {
      init();
      return () => {
        cleanupRef.current?.();
        xtermRef.current?.dispose();
        window.electronAPI.terminal.destroy(id).catch(() => {});
      };
    }, [init, id]);

    // ResizeObserver
    useEffect(() => {
      const c = containerRef.current;
      if (!c) return;
      const obs = new ResizeObserver(() => fitAddonRef.current?.fit());
      obs.observe(c);
      return () => obs.disconnect();
    }, []);

    return <div ref={containerRef} className="flex-1 overflow-hidden" style={{ width: '100%', height: '100%' }} />;
  },
);

TerminalSingle.displayName = 'TerminalSingle';
