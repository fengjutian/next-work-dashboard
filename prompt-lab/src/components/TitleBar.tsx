import React from 'react';
import { Check, Maximize2, Minus, X } from '@/components/icons';
import { pluginRegistry } from '@/plugins';
import { useStore } from '@/store';

type MenuName = 'file' | 'modules' | 'view';

export const TitleBar: React.FC = () => {
  const { activeActivity, setActiveActivity, theme, setTheme } = useStore();
  const [openMenu, setOpenMenu] = React.useState<MenuName | null>(null);
  const [maximized, setMaximized] = React.useState(false);
  const [, refreshPlugins] = React.useState(0);
  const barRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void window.electronAPI.isMaximized().then(setMaximized);
    return window.electronAPI.onMaximizedChange(setMaximized);
  }, []);

  React.useEffect(() => pluginRegistry.subscribe(() => refreshPlugins((value) => value + 1)), []);

  React.useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', closeMenu);
    return () => window.removeEventListener('mousedown', closeMenu);
  }, []);

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '1') {
        event.preventDefault();
        setActiveActivity('ai');
      } else if (event.key === ',') {
        event.preventDefault();
        setActiveActivity('settings');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [setActiveActivity]);

  const toggleMenu = (menu: MenuName) => setOpenMenu((current) => current === menu ? null : menu);
  const run = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <div ref={barRef} className="titlebar-drag titlebar-auspicious-purple relative z-[100] flex h-8 flex-shrink-0 items-center border-b text-xs text-white shadow-sm select-none">
      <nav className="titlebar-no-drag flex h-full items-center px-1" aria-label="应用菜单">
        <MenuButton label="文件" open={openMenu === 'file'} onClick={() => toggleMenu('file')}>
          <MenuItem label="AI 工作台" shortcut="Ctrl+1" onClick={() => run(() => setActiveActivity('ai'))} />
          <MenuItem label="设置" shortcut="Ctrl+," onClick={() => run(() => setActiveActivity('settings'))} />
          <MenuDivider />
          <MenuItem label="关闭窗口" shortcut="Alt+F4" onClick={() => run(() => void window.electronAPI.close())} />
        </MenuButton>

        <MenuButton label="模块" open={openMenu === 'modules'} onClick={() => toggleMenu('modules')}>
          {pluginRegistry.getEnabled().map((plugin) => (
            <MenuItem
              key={plugin.id}
              label={plugin.name}
              checked={activeActivity === plugin.id || (plugin.id === 'ai' && activeActivity === null)}
              onClick={() => run(() => setActiveActivity(plugin.id))}
            />
          ))}
        </MenuButton>

        <MenuButton label="视图" open={openMenu === 'view'} onClick={() => toggleMenu('view')}>
          <MenuItem label="浅色主题" checked={theme === 'light'} onClick={() => run(() => setTheme('light'))} />
          <MenuItem label="深色主题" checked={theme === 'dark'} onClick={() => run(() => setTheme('dark'))} />
          <MenuItem label="跟随系统" checked={theme === 'system'} onClick={() => run(() => setTheme('system'))} />
          <MenuDivider />
          <MenuItem label="重新加载" shortcut="Ctrl+R" onClick={() => run(() => window.location.reload())} />
        </MenuButton>
      </nav>

      <div className="flex-1 self-stretch" onDoubleClick={() => void window.electronAPI.maximize()} />

      <div className="titlebar-no-drag flex h-full items-center">
        <WindowButton label="最小化" onClick={() => void window.electronAPI.minimize()}>
          <Minus className="h-3.5 w-3.5" />
        </WindowButton>
        <WindowButton label={maximized ? '还原' : '最大化'} onClick={() => void window.electronAPI.maximize()}>
          <Maximize2 className="h-3.5 w-3.5" />
        </WindowButton>
        <WindowButton label="关闭" close onClick={() => void window.electronAPI.close()}>
          <X className="h-4 w-4" />
        </WindowButton>
      </div>
    </div>
  );
};

const MenuButton: React.FC<React.PropsWithChildren<{ label: string; open: boolean; onClick: () => void }>> = ({ label, open, onClick, children }) => (
  <div className="relative h-full">
    <button type="button" className={`h-full px-3 transition-colors ${open ? 'bg-white/20 text-white' : 'text-white/85 hover:bg-white/15 hover:text-white'}`} aria-expanded={open} onClick={onClick}>{label}</button>
    {open && <div className="absolute left-0 top-[calc(100%+1px)] min-w-48 rounded-md border bg-popover py-1 text-popover-foreground shadow-lg">{children}</div>}
  </div>
);

const MenuItem: React.FC<{ label: string; shortcut?: string; checked?: boolean; onClick: () => void }> = ({ label, shortcut, checked, onClick }) => (
  <button type="button" className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-accent" onClick={onClick}>
    <span className="flex w-4 justify-center">{checked && <Check className="h-3.5 w-3.5" />}</span>
    <span className="flex-1 whitespace-nowrap">{label}</span>
    {shortcut && <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>}
  </button>
);

const MenuDivider = () => <div className="my-1 h-px bg-border" />;

const WindowButton: React.FC<React.PropsWithChildren<{ label: string; close?: boolean; onClick: () => void }>> = ({ label, close, onClick, children }) => (
  <button type="button" className={`flex h-full w-11 items-center justify-center text-white/90 transition-colors ${close ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-white/15 hover:text-white'}`} title={label} aria-label={label} onClick={onClick}>{children}</button>
);
