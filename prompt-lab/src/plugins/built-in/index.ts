/**
 * 内置插件注册 — 将现有面板组件包装为 Plugin 并注册到 registry。
 * 在 App 初始化时调用 registerBuiltInPlugins() 即可。
 */
import { Sparkles, Blocks, Network, StickyNote, Puzzle, BookOpen, Globe, Terminal, Database, Robot, Word, Excel, Ppt, Draw, Pdf, Code, FileText, FileSearch, Weread, HanyuJinjie, Languages, Image, HardDrive } from '@/components/icons';
import { lazy, type ComponentType } from 'react';
import { pluginRegistry } from '../registry';
import type { Plugin } from '../types';
import { EXCEL_PREVIEW_DEFAULT_ENABLED } from '../defaults';
import { KnowledgeGraph } from '../knowledge-graph';

function preloadable<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): { component: T; preload: () => Promise<{ default: T }> } {
  let pending: Promise<{ default: T }> | undefined;
  const preload = () => (pending ??= loader());
  return { component: lazy(preload) as unknown as T, preload };
}

const aiPanel = preloadable(() => import('../ai').then((m) => ({ default: m.AIPanel })));
const aiChatModule = preloadable(() => import('../ai-chat-module').then((m) => ({ default: m.AIChatModule })));
const promptSidebar = preloadable(() => import('../prompts').then((m) => ({ default: m.PromptSidebar })));
const conversationHistory = preloadable(() => import('../history').then((m) => ({ default: m.ConversationHistory })));
const notesPanel = preloadable(() => import('../notes').then((m) => ({ default: m.NotesPanel })));
const AIPanel = aiPanel.component;
const AIChatModule = aiChatModule.component;
const PromptSidebar = promptSidebar.component;
const ConversationHistory = conversationHistory.component;
const NotesPanel = notesPanel.component;
const wordPreview = preloadable(() => import('../word-preview').then((m) => ({ default: m.WordPreviewPanel })));
const excelPreview = preloadable(() => import('../excel-preview').then((m) => ({ default: m.ExcelPreviewPanel })));
const pptPreview = preloadable(() => import('../ppt-preview').then((m) => ({ default: m.PptPreviewPanel })));
const officeStudio = preloadable(() => import('../office-studio').then((m) => ({ default: m.OfficeStudioPanel })));
const pdfPreview = preloadable(() => import('../pdf-preview').then((m) => ({ default: m.PdfPreviewPanel })));
const excalidraw = preloadable(() => import('../excalidraw').then((m) => ({ default: m.ExcalidrawPanel })));
const pluginManager = preloadable(() => import('../plugin-manager').then((m) => ({ default: m.PluginManagerPanel })));
const weread = preloadable(() => import('../weread').then((m) => ({ default: m.WereadPanel })));
const translation = preloadable(() => import('../translation').then((m) => ({ default: m.TranslationPanel })));
const windy = preloadable(() => import('../windy').then((m) => ({ default: m.WindyPanel })));
const terminal = preloadable(() => import('../terminal').then((m) => ({ default: m.TerminalPluginPanel })));
const database = preloadable(() => import('../database').then((m) => ({ default: m.DatabaseBrowser })));
const codeEditor = preloadable(() => import('../code-editor').then((m) => ({ default: m.CodeEditorPanel })));
const compare = preloadable(() => import('../compare').then((m) => ({ default: m.ComparePanel })));
const documentKnowledge = preloadable(() => import('../document-knowledge').then((m) => ({ default: m.DocumentKnowledgePanel })));
const hanyuJinjie = preloadable(() => import('../hanyu-jinjie').then((m) => ({ default: m.HanyuJinjiePanel })));
const lingoHut = preloadable(() => import('../lingohut').then((m) => ({ default: m.LingoHutPanel })));
const styleImage = preloadable(() => import('../style-image').then((m) => ({ default: m.StyleImagePanel })));
const screenCapture = preloadable(() => import('../screen-capture').then((m) => ({ default: m.ScreenCapturePanel })));
const diskSpace = preloadable(() => import('../disk-space').then((m) => ({ default: m.DiskSpacePanel })));
const lyricStudio = preloadable(() => import('../lyric-studio').then((m) => ({ default: m.LyricStudioPanel })));
const WordPreviewPanel = wordPreview.component;
const ExcelPreviewPanel = excelPreview.component;
const PptPreviewPanel = pptPreview.component;
const OfficeStudioPanel = officeStudio.component;
const PdfPreviewPanel = pdfPreview.component;
const ExcalidrawPanel = excalidraw.component;
const PluginManagerPanel = pluginManager.component;
const WereadPanel = weread.component;
const TranslationPanel = translation.component;
const WindyPanel = windy.component;
const TerminalPluginPanel = terminal.component;
const DatabaseBrowser = database.component;
const CodeEditorPanel = codeEditor.component;
const ComparePanel = compare.component;
const DocumentKnowledgePanel = documentKnowledge.component;
const HanyuJinjiePanel = hanyuJinjie.component;
const LingoHutPanel = lingoHut.component;
const StyleImagePanel = styleImage.component;
const ScreenCapturePanel = screenCapture.component;
const DiskSpacePanel = diskSpace.component;
const LyricStudioPanel = lyricStudio.component;

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
    keepAlive: true,
    order: 1,
    contributions: {
      commands: [
        { id: 'chat.clear', title: '清空对话', category: 'AI 对话' },
      ],
    },
  },
  {
    id: 'prompts',
    name: '提示词与技能',
    icon: Blocks,
    component: PromptSidebar,
    enabled: true,
    order: 2,
    contributions: {
      commands: [
        { id: 'prompts.create', title: '新建提示词', category: '提示词与技能' },
        { id: 'prompts.search', title: '搜索提示词', category: '提示词与技能' },
      ],
    },
  },
  {
    id: 'office-studio',
    name: 'Office Studio',
    icon: FileText,
    component: OfficeStudioPanel,
    enabled: false,
    order: 12,
    keepAlive: true,
    activate: (context) => {
      context.subscriptions.add(context.commands.register('office-studio.open', () => { window.dispatchEvent(new CustomEvent('office-studio:command', { detail: { command: 'open' } })); }));
      context.subscriptions.add(context.commands.register('office-studio.create', () => { window.dispatchEvent(new CustomEvent('office-studio:command', { detail: { command: 'create' } })); }));
    },
    contributions: {
      commands: [
        { id: 'office-studio.open', title: '打开 Office 文档', category: 'Office Studio' },
        { id: 'office-studio.create', title: '新建 Office 文档', category: 'Office Studio' },
      ],
      views: [{ id: 'office-studio.editor', title: 'Office Studio', component: OfficeStudioPanel, location: 'main' }],
      fileEditors: [{ id: 'office-studio.editor', extensions: ['.docx', '.xlsx', '.pptx'], viewId: 'office-studio.editor', priority: 200 }],
      settings: [{ key: 'office-studio.autoPreview', label: '打开后自动渲染', type: 'boolean', default: true }],
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
    icon: Weread,
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
    id: 'compare',
    name: '文本比较',
    icon: FileText,
    component: ComparePanel,
    enabled: true,
    order: 18,
    keepAlive: true,
    contributions: {
      commands: [{ id: 'compare.open', title: '打开文本比较', category: '文本比较' }],
      views: [{ id: 'compare.main', title: '文本比较', component: ComparePanel, location: 'main' }],
    },
  },
  {
    id: 'document-knowledge',
    name: '文档知识库',
    icon: FileSearch,
    component: DocumentKnowledgePanel,
    enabled: true,
    order: 19,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'document-knowledge.upload', title: '上传并解析文档', category: '文档知识库' },
      ],
      views: [{ id: 'document-knowledge.main', title: '文档知识库', component: DocumentKnowledgePanel, location: 'main' }],
    },
  },
  {
    id: 'hanyu-jinjie',
    name: '汉语新解',
    icon: HanyuJinjie,
    component: HanyuJinjiePanel,
    enabled: true,
    order: 20,
  },
  {
    id: 'lingohut',
    name: 'LingoHut 语言学习',
    icon: Languages,
    component: LingoHutPanel,
    enabled: true,
    keepAlive: true,
    order: 21,
  },
  {
    id: 'style-image',
    name: '风格图片',
    icon: Image,
    component: StyleImagePanel,
    enabled: true,
    keepAlive: true,
    order: 22,
    contributions: { commands: [{ id: 'style-image.generate', title: '生成风格图片', category: '风格图片' }] },
  },
  {
    id: 'screen-capture', name: '屏幕捕获', icon: Image, component: ScreenCapturePanel, enabled: true, order: 23,
  },
  {
    id: 'disk-space', name: '磁盘空间', icon: HardDrive, component: DiskSpacePanel, enabled: false, order: 24, keepAlive: true,
    contributions: { commands: [{ id: 'disk-space.scan', title: '分析磁盘空间', category: '磁盘空间' }] },
  },
  {
    id: 'lyric-studio', name: '歌词工坊', icon: Draw, component: LyricStudioPanel, enabled: true, order: 25, keepAlive: true,
    contributions: {
      commands: [{ id: 'lyric-studio.generate', title: 'AI 生成整首歌词', category: '歌词工坊' }],
      views: [{ id: 'lyric-studio.main', title: '歌词工坊', component: LyricStudioPanel, location: 'main' }],
      settings: [{ key: 'lyric-studio.autoSave', label: '自动保存项目', type: 'boolean', default: true }],
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
  const preloadById: Record<string, () => Promise<unknown>> = {
    ai: aiPanel.preload,
    chat: aiChatModule.preload,
    prompts: promptSidebar.preload,
    history: conversationHistory.preload,
    notes: notesPanel.preload,
    weread: weread.preload,
    translator: translation.preload,
    windy: windy.preload,
    'word-preview': wordPreview.preload,
    'excel-preview': excelPreview.preload,
    'ppt-preview': pptPreview.preload,
    'office-studio': officeStudio.preload,
    'pdf-preview': pdfPreview.preload,
    excalidraw: excalidraw.preload,
    'plugin-manager': pluginManager.preload,
    terminal: terminal.preload,
    database: database.preload,
    'code-editor': codeEditor.preload,
    compare: compare.preload,
    'document-knowledge': documentKnowledge.preload,
    'hanyu-jinjie': hanyuJinjie.preload,
    lingohut: lingoHut.preload,
    'style-image': styleImage.preload,
    'screen-capture': screenCapture.preload,
    'disk-space': diskSpace.preload,
    'lyric-studio': lyricStudio.preload,
  };
  pluginRegistry.registerAll(builtInPlugins.map((plugin) => ({
    ...plugin,
    source: 'built-in',
    preload: preloadById[plugin.id],
  })));
}

export { builtInPlugins };
