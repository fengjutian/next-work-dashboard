/**
 * Plugin 入口 — 暴露给 src/plugins/built-in/index.ts 注册。
 *
 * 设计要点：
 *  1. fileEditors 在 markdown 扩展名上设 priority 100，但加 settings.handleMarkdownFiles
 *     时动态重新注册。
 *  2. 默认 handleMarkdownFiles = true（默认由我们接管）。
 *  3. 通过 activate 钩子持久化设置到 localStorage，
 *     并监听 window 事件做动态重注册。
 */
import type { Plugin } from '../types';
import { MarkdownEditorPanel } from './MarkdownEditorPanel';
import { FileText } from '@/components/icons';
import { pluginRegistry } from '../registry';
import { DEFAULT_MARKDOWN_EDITOR_SETTINGS, type MarkdownEditorSettings } from './types';

const SETTINGS_KEY = 'markdown-editor.settings.v1';

function readSettings(): MarkdownEditorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_MARKDOWN_EDITOR_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_MARKDOWN_EDITOR_SETTINGS };
}

function writeSettings(settings: MarkdownEditorSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function buildFileEditors(handle: boolean) {
  if (!handle) return [];
  return [
    {
      id: 'markdown-editor.default',
      extensions: ['.md', '.markdown'],
      viewId: 'markdown-editor.main',
      priority: 100,
    },
  ];
}

function buildSettingsDef() {
  return [
    {
      key: 'markdown-editor.handleMarkdownFiles',
      label: '默认接管 .md 文件（关闭则由代码编辑处理）',
      type: 'boolean' as const,
      default: DEFAULT_MARKDOWN_EDITOR_SETTINGS.handleMarkdownFiles,
    },
    {
      key: 'markdown-editor.autoSave',
      label: '自动保存（停止输入 1.5s 后触发）',
      type: 'boolean' as const,
      default: DEFAULT_MARKDOWN_EDITOR_SETTINGS.autoSave,
    },
  ];
}

let currentPlugin: Plugin | null = null;
let unsubscribeSettings: (() => void) | null = null;

function registerWithSettings(settings: MarkdownEditorSettings): void {
  const plugin: Plugin = {
    id: 'markdown-editor',
    name: 'Markdown 编辑',
    icon: FileText,
    component: MarkdownEditorPanel,
    enabled: true,
    order: 17.5, // 介于 code-editor(17) 和 compare(18) 之间
    keepAlive: true,
    preload: async () => {
      // 触发 lazy import 预热
      await import('./MarkdownWorkspaceController');
    },
    contributions: {
      commands: [
        { id: 'markdown-editor.open', title: '打开 Markdown 文件', category: 'Markdown 编辑' },
        { id: 'markdown-editor.save', title: '保存 Markdown 文件', category: 'Markdown 编辑' },
        { id: 'markdown-editor.toggleSourceMode', title: '切换源码 / 可视化模式', category: 'Markdown 编辑' },
      ],
      views: [
        { id: 'markdown-editor.main', title: 'Markdown 编辑', component: MarkdownEditorPanel, location: 'main' },
      ],
      fileEditors: buildFileEditors(settings.handleMarkdownFiles),
      settings: buildSettingsDef(),
      menus: [{ id: 'markdown-editor.open.menu', label: '打开 Markdown 文件', command: 'markdown-editor.open', location: 'file', order: 21 }],
    },
    activate: (context) => {
      context.subscriptions.add(() => {
        // 清理监听
      });
      // 监听设置变化：插件存储中的 setting key 变化由 useStore/useDbPersistence 管理。
      // 这里通过一个轻量级 storage 事件来检测跨标签变化。
      const storageHandler = (event: StorageEvent) => {
        if (event.key !== SETTINGS_KEY || !event.newValue) return;
        try {
          const next = { ...DEFAULT_MARKDOWN_EDITOR_SETTINGS, ...JSON.parse(event.newValue) };
          reRegister(next);
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('storage', storageHandler);
      unsubscribeSettings = () => window.removeEventListener('storage', storageHandler);
      context.subscriptions.add(() => unsubscribeSettings?.());
      // 提供命令
      context.commands.register('markdown-editor.open', () => {
        window.dispatchEvent(new CustomEvent('markdown-editor:open-file', { detail: {} }));
      });
      context.commands.register('markdown-editor.save', () => {
        window.dispatchEvent(new CustomEvent('markdown-editor:save', { detail: {} }));
      });
      context.commands.register('markdown-editor.toggleSourceMode', () => {
        window.dispatchEvent(new CustomEvent('markdown-editor:toggle-source', { detail: {} }));
      });
    },
    deactivate: () => {
      unsubscribeSettings?.();
      unsubscribeSettings = null;
    },
  };
  currentPlugin = plugin;
  pluginRegistry.register(plugin);
}

function reRegister(settings: MarkdownEditorSettings): void {
  if (!currentPlugin) return;
  const next: Plugin = {
    ...currentPlugin,
    contributions: {
      ...currentPlugin.contributions,
      fileEditors: buildFileEditors(settings.handleMarkdownFiles),
      settings: buildSettingsDef(),
    },
  };
  currentPlugin = next;
  pluginRegistry.register(next);
}

/**
 * 同步设置变更 — 由设置面板调用，传入新设置对象。
 * 暴露给 built-in/index.ts 在初始化时调用一次。
 */
export function applyMarkdownEditorSettings(patch: Partial<MarkdownEditorSettings>): void {
  const merged = { ...readSettings(), ...patch };
  writeSettings(merged);
  reRegister(merged);
}

registerWithSettings(readSettings());

export { MarkdownEditorPanel };
