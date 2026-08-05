/**
 * 内置插件注册 — 将现有面板组件包装为 Plugin 并注册到 registry。
 * 在 App 初始化时调用 registerBuiltInPlugins() 即可。
 */
import { Sparkles, MessageSquare, Network, StickyNote, Puzzle, BookOpen, Globe, Terminal, Database, Robot, Word, Excel, Ppt, Draw, Pdf, Code } from '@/components/icons';
import { lazy } from 'react';
import { pluginRegistry } from '../registry';
import type { Plugin } from '../types';
import { EXCEL_PREVIEW_DEFAULT_ENABLED } from '../defaults';

const AIPanel = lazy(() => import('../ai').then((m) => ({ default: m.AIPanel })));
const AIChatModule = lazy(() => import('../ai-chat-module').then((m) => ({ default: m.AIChatModule })));
const PromptSidebar = lazy(() => import('../prompts').then((m) => ({ default: m.PromptSidebar })));
const ConversationHistory = lazy(() => import('../history').then((m) => ({ default: m.ConversationHistory })));
const KnowledgeGraph = lazy(() => import('../knowledge-graph').then((m) => ({ default: m.KnowledgeGraph })));
const NotesPanel = lazy(() => import('../notes').then((m) => ({ default: m.NotesPanel })));
const WordPreviewPanel = lazy(() => import('../word-preview').then((m) => ({ default: m.WordPreviewPanel })));
const ExcelPreviewPanel = lazy(() => import('../excel-preview').then((m) => ({ default: m.ExcelPreviewPanel })));
const PptPreviewPanel = lazy(() => import('../ppt-preview').then((m) => ({ default: m.PptPreviewPanel })));
const PdfPreviewPanel = lazy(() => import('../pdf-preview').then((m) => ({ default: m.PdfPreviewPanel })));
const ExcalidrawPanel = lazy(() => import('../excalidraw').then((m) => ({ default: m.ExcalidrawPanel })));
const PluginManagerPanel = lazy(() => import('../plugin-manager').then((m) => ({ default: m.PluginManagerPanel })));
const WereadPanel = lazy(() => import('../weread').then((m) => ({ default: m.WereadPanel })));
const TranslationPanel = lazy(() => import('../translation').then((m) => ({ default: m.TranslationPanel })));
const WindyPanel = lazy(() => import('../windy').then((m) => ({ default: m.WindyPanel })));
const TerminalPluginPanel = lazy(() => import('../terminal').then((m) => ({ default: m.TerminalPluginPanel })));
const DatabaseBrowser = lazy(() => import('../database').then((m) => ({ default: m.DatabaseBrowser })));
const CodeEditorPanel = lazy(() => import('../code-editor').then((m) => ({ default: m.CodeEditorPanel })));

const builtInPlugins: Plugin[] = [
  {
    id: 'ai',
    name: 'AI',
    icon: Sparkles,
    component: AIPanel,
    enabled: true,
    order: 0,
    contributions: {
      commands: [
        { id: 'ai.newTab', title: '打开新标签页', category: 'AI' },
        { id: 'ai.closeTab', title: '关闭当前标签页', category: 'AI' },
      ],
    },
  },
  {
    id: 'chat',
    name: 'AI 对话',
    icon: Robot,
    component: AIChatModule,
    enabled: true,
    order: 1,
    contributions: {
      commands: [
        { id: 'chat.clear', title: '清空对话', category: 'AI 对话' },
      ],
    },
  },
  {
    id: 'prompts',
    name: '提示词',
    icon: MessageSquare,
    component: PromptSidebar,
    enabled: true,
    order: 2,
    contributions: {
      commands: [
        { id: 'prompts.create', title: '新建提示词', category: '提示词' },
        { id: 'prompts.search', title: '搜索提示词', category: '提示词' },
      ],
    },
  },
  {
    id: 'history',
    name: '知识库',
    icon: BookOpen,
    component: ConversationHistory,
    enabled: true,
    order: 3,
  },
  {
    id: 'graph',
    name: '知识图谱',
    icon: Network,
    component: KnowledgeGraph,
    enabled: true,
    order: 4,
  },
  {
    id: 'notes',
    name: '便签',
    icon: StickyNote,
    component: NotesPanel,
    enabled: false,
    order: 5,
    contributions: {
      commands: [
        { id: 'notes.new', title: '新建便签', category: '便签' },
      ],
    },
  },
  {
    id: 'weread',
    name: '微信读书',
    icon: BookOpen,
    component: WereadPanel,
    enabled: false,
    order: 6,
  },
  {
    id: 'translator',
    name: '百度翻译',
    icon: Globe,
    component: TranslationPanel,
    enabled: false,
    order: 11,
  },
  {
    id: 'windy',
    name: 'Windy',
    icon: Globe,
    component: WindyPanel,
    enabled: false,
    order: 7,
  },
  {
    id: 'word-preview',
    name: 'Word 预览',
    icon: Word,
    component: WordPreviewPanel,
    enabled: false,
    order: 12,
    contributions: {
      commands: [
        { id: 'word-preview.open', title: '打开 Word 文档', category: 'Word 预览' },
        { id: 'word-preview.close', title: '关闭当前文档', category: 'Word 预览' },
      ],
      views: [{ id: 'word-preview.editor', title: 'Word 预览', component: WordPreviewPanel, location: 'main' }],
      fileEditors: [{ id: 'word-preview.editor', extensions: ['.docx'], viewId: 'word-preview.editor', priority: 100 }],
    },
  },
  {
    id: 'excel-preview',
    name: 'Excel 编辑',
    icon: Excel,
    component: ExcelPreviewPanel,
    enabled: EXCEL_PREVIEW_DEFAULT_ENABLED,
    order: 13,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'excel-preview.open', title: '打开 Excel 文件', category: 'Excel 编辑' },
        { id: 'excel-preview.save', title: '保存当前表格', category: 'Excel 编辑' },
      ],
      views: [{ id: 'excel-preview.editor', title: 'Excel 编辑', component: ExcelPreviewPanel, location: 'main' }],
      fileEditors: [{ id: 'excel-preview.editor', extensions: ['.xlsx', '.xls'], viewId: 'excel-preview.editor', priority: 100 }],
      settings: [{ key: 'excel-preview.autoSave', label: '自动保存', type: 'boolean', default: false }],
    },
  },
  {
    id: 'ppt-preview',
    name: 'PPT 演示',
    icon: Ppt,
    component: PptPreviewPanel,
    enabled: false,
    order: 14,
    contributions: {
      commands: [
        { id: 'ppt-preview.open', title: '打开 PPT 文件', category: 'PPT 演示' },
        { id: 'ppt-preview.export', title: '导出 PPTX', category: 'PPT 演示' },
      ],
      views: [{ id: 'ppt-preview.editor', title: 'PPT 演示', component: PptPreviewPanel, location: 'main' }],
      fileEditors: [{ id: 'ppt-preview.editor', extensions: ['.pptx'], viewId: 'ppt-preview.editor', priority: 100 }],
    },
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw 白板',
    icon: Draw,
    component: ExcalidrawPanel,
    enabled: true,
    order: 15,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'excalidraw.export', title: '导出图片', category: 'Excalidraw' },
        { id: 'excalidraw.clear', title: '清空画布', category: 'Excalidraw' },
      ],
    },
  },
  {
    id: 'pdf-preview',
    name: 'PDF 预览',
    icon: Pdf,
    component: PdfPreviewPanel,
    enabled: true,
    order: 16,
    contributions: {
      commands: [
        { id: 'pdf-preview.open', title: '打开 PDF 文件', category: 'PDF 预览' },
        { id: 'pdf-preview.close', title: '关闭当前 PDF', category: 'PDF 预览' },
      ],
      views: [{ id: 'pdf-preview.viewer', title: 'PDF 预览', component: PdfPreviewPanel, location: 'main' }],
      fileEditors: [{ id: 'pdf-preview.viewer', extensions: ['.pdf'], viewId: 'pdf-preview.viewer', priority: 100 }],
    },
  },
  {
    id: 'code-editor',
    name: '代码编辑',
    icon: Code,
    component: CodeEditorPanel,
    enabled: true,
    order: 17,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'code-editor.open', title: '打开代码文件', category: '代码编辑' },
        { id: 'code-editor.save', title: '保存代码文件', category: '代码编辑' },
      ],
      views: [{ id: 'code-editor.editor', title: '代码编辑器', component: CodeEditorPanel, location: 'main' }],
      fileEditors: [{ id: 'code-editor.editor', extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html'], viewId: 'code-editor.editor', priority: 10 }],
      menus: [{ id: 'code-editor.open.menu', label: '打开代码文件', command: 'code-editor.open', location: 'file', order: 20 }],
      settings: [{ key: 'code-editor.wordWrap', label: '自动换行', type: 'boolean', default: true }],
    },
  },
  {
    id: 'plugin-manager',
    name: '插件管理',
    icon: Puzzle,
    component: PluginManagerPanel,
    enabled: true,
    order: 8,
    contributions: {
      commands: [
        { id: 'plugin-manager.create', title: '新建插件', category: '插件管理' },
        { id: 'plugin-manager.import', title: '导入 .nwd 插件', category: '插件管理' },
      ],
    },
  },
  {
    id: 'terminal',
    name: '终端',
    icon: Terminal,
    component: TerminalPluginPanel,
    enabled: false,
    order: 9,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'terminal.new', title: '新建终端', category: '终端' },
      ],
    },
  },
  {
    id: 'database',
    name: '数据库',
    icon: Database,
    component: DatabaseBrowser,
    enabled: true,
    order: 10,
  },
];

export function registerBuiltInPlugins(): void {
  pluginRegistry.registerAll(builtInPlugins.map((plugin) => ({ ...plugin, source: 'built-in' })));
}

export { builtInPlugins };
