/**
 * 内置插件注册 — 将现有面板组件包装为 Plugin 并注册到 registry。
 * 在 App 初始化时调用 registerBuiltInPlugins() 即可。
 */
import { Sparkles, Blocks, Network, StickyNote, Puzzle, BookOpen, Globe, Terminal, Database, Robot, Word, Excel, Ppt, Draw, Pdf, Code, FileText, FileSearch, Weread, HanyuJinjie, Languages, Image, HardDrive, Video, Phone, AudioLines, WorkBrowser, ShieldAudit } from '@/components/icons';
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
const markdownEditor = preloadable(() => import('../markdown-editor').then((m) => ({ default: m.MarkdownEditorPanel })));
const compare = preloadable(() => import('../compare').then((m) => ({ default: m.ComparePanel })));
const documentKnowledge = preloadable(() => import('../document-knowledge').then((m) => ({ default: m.DocumentKnowledgePanel })));
const hanyuJinjie = preloadable(() => import('../hanyu-jinjie').then((m) => ({ default: m.HanyuJinjiePanel })));
const lingoHut = preloadable(() => import('../lingohut').then((m) => ({ default: m.LingoHutPanel })));
const styleImage = preloadable(() => import('../style-image').then((m) => ({ default: m.StyleImagePanel })));
const screenCapture = preloadable(() => import('../screen-capture').then((m) => ({ default: m.ScreenCapturePanel })));
const diskSpace = preloadable(() => import('../disk-space').then((m) => ({ default: m.DiskSpacePanel })));
const networkObservatory = preloadable(() => import('../network-observatory').then((m) => ({ default: m.NetworkObservatoryPanel })));
const lyricStudio = preloadable(() => import('../lyric-studio').then((m) => ({ default: m.LyricStudioPanel })));
const videoPlayer = preloadable(() => import('../video-player').then((m) => ({ default: m.VideoPlayerPanel })));
const mycast = preloadable(() => import('../mycast').then((m) => ({ default: m.MyCastPanel })));
const phone = preloadable(() => import('../phone').then((m) => ({ default: m.PhonePanel })));
const voiceInput = preloadable(() => import('../voice-input').then((m) => ({ default: m.VoiceInputPanel })));
const zodiacPerspectives = preloadable(() => import('../zodiac-perspectives').then((m) => ({ default: m.ZodiacPerspectivesPanel })));
const thinkingLab = preloadable(() => import('../thinking-lab').then((m) => ({ default: m.ThinkingLabPanel })));
const workBrowser = preloadable(() => import('../work-browser').then((m) => ({ default: m.WorkBrowserPanel })));
const securityAudit = preloadable(() => import('../security-audit').then((m) => ({ default: m.SecurityAuditPanel })));
const videoGeneration = preloadable(() => import('../video-generation').then((m) => ({ default: m.VideoGenerationPanel })));
const englishLookup = preloadable(() => import('../english-lookup').then((m) => ({ default: m.EnglishLookupPanel })));
const calcPath = preloadable(() => import('../calcpath').then((m) => ({ default: m.CalcPathPanel })));
const rssReader = preloadable(() => import('../rss-reader').then((m) => ({ default: m.RssReaderPanel })));
const outlineScaffolder = preloadable(() => import('../outline-scaffolder').then((m) => ({ default: m.OutlineScaffolderPanel })));
const classicalReading = preloadable(() => import('../classical-reading').then((m) => ({ default: m.ClassicalReadingPanel })));
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
const MarkdownEditorPanel = markdownEditor.component;
const ComparePanel = compare.component;
const DocumentKnowledgePanel = documentKnowledge.component;
const HanyuJinjiePanel = hanyuJinjie.component;
const LingoHutPanel = lingoHut.component;
const StyleImagePanel = styleImage.component;
const ScreenCapturePanel = screenCapture.component;
const DiskSpacePanel = diskSpace.component;
const NetworkObservatoryPanel = networkObservatory.component;
const LyricStudioPanel = lyricStudio.component;
const VideoPlayerPanel = videoPlayer.component;
const MyCastPanel = mycast.component;
const PhonePanel = phone.component;
const VoiceInputPanel = voiceInput.component;
const ZodiacPerspectivesPanel = zodiacPerspectives.component;
const ThinkingLabPanel = thinkingLab.component;
const WorkBrowserPanel = workBrowser.component;
const SecurityAuditPanel = securityAudit.component;
const VideoGenerationPanel = videoGeneration.component;
const EnglishLookupPanel = englishLookup.component;
const CalcPathPanel = calcPath.component;
const RssReaderPanel = rssReader.component;
const OutlineScaffolderPanel = outlineScaffolder.component;
const ClassicalReadingPanel = classicalReading.component;

const builtInPlugins: Plugin[] = [
  {
    id: 'outline-scaffolder',
    name: '章节文档生成器',
    icon: FileText,
    component: OutlineScaffolderPanel,
    enabled: true,
    order: 8,
    contributions: {
      commands: [{ id: 'outline-scaffolder.create', title: '批量创建章节文档', category: '章节文档生成器' }],
    },
  },
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
    id: 'calcpath', name: 'CalcPath 微积分', icon: BookOpen, component: CalcPathPanel, enabled: false, order: 22, keepAlive: true,
    contributions: { commands: [{ id: 'calcpath.practice', title: '开始自适应微积分练习', category: 'CalcPath' }] },
    activate: (context) => context.commands.register('calcpath.practice', () => window.dispatchEvent(new CustomEvent('calcpath:practice'))),
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
      // 故意移除 .md / .markdown 扩展 — markdown-editor 插件独立管理这些扩展；
      // 用户可在 markdown-editor 的设置里关闭接管以回退到这里。
      fileEditors: [{ id: 'code-editor.editor', extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html'], viewId: 'code-editor.editor', priority: 10 }],
      menus: [{ id: 'code-editor.open.menu', label: '打开代码文件', command: 'code-editor.open', location: 'file', order: 20 }],
      settings: [{ key: 'code-editor.wordWrap', label: '自动换行', type: 'boolean', default: true }],
    },
  },
  {
    id: 'markdown-editor-legacy',
    name: 'Markdown 编辑',
    icon: FileText,
    component: MarkdownEditorPanel,
    enabled: false,
    order: 17.5,
    keepAlive: true,
    preload: () => import('../markdown-editor'),
    contributions: {
      commands: [
        { id: 'markdown-editor.open', title: '打开 Markdown 文件', category: 'Markdown 编辑' },
        { id: 'markdown-editor.save', title: '保存 Markdown 文件', category: 'Markdown 编辑' },
        { id: 'markdown-editor.toggleSourceMode', title: '切换源码 / 可视化模式', category: 'Markdown 编辑' },
      ],
      views: [{ id: 'markdown-editor.main', title: 'Markdown 编辑', component: MarkdownEditorPanel, location: 'main' }],
      // 文件扩展声明在 src/plugins/markdown-editor/index.ts 启动时根据用户设置动态注入；
      // 默认 handleMarkdownFiles=true 时拥有 .md/.markdown 优先级 100。
      fileEditors: [],
      menus: [{ id: 'markdown-editor.open.menu', label: '打开 Markdown 文件', command: 'markdown-editor.open', location: 'file', order: 21 }],
      settings: [
        { key: 'markdown-editor.handleMarkdownFiles', label: '默认接管 .md 文件（关闭则由代码编辑处理）', type: 'boolean', default: true },
        { key: 'markdown-editor.autoSave', label: '自动保存（停止输入 1.5s 后触发）', type: 'boolean', default: false },
      ],
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
    id: 'markdown-editor',
    name: 'Markdown 编辑',
    icon: FileText,
    component: MarkdownEditorPanel,
    enabled: true,
    order: 18,
    keepAlive: true,
    activate: (context) => {
      context.subscriptions.add(context.commands.register('markdown-editor.open', () => {
        window.dispatchEvent(new CustomEvent('markdown-editor:command', { detail: { command: 'open' } }));
      }));
    },
    contributions: {
      commands: [
        { id: 'markdown-editor.open', title: '打开 Markdown 文件', category: 'Markdown 编辑' },
        { id: 'markdown-editor.save', title: '保存当前 Markdown', category: 'Markdown 编辑' },
        { id: 'markdown-editor.toggleMode', title: '切换可视化 / 源码', category: 'Markdown 编辑' },
      ],
      views: [{ id: 'markdown-editor.main', title: 'Markdown 编辑', component: MarkdownEditorPanel, location: 'main' }],
      fileEditors: [{ id: 'markdown-editor.default', extensions: ['.md', '.markdown'], viewId: 'markdown-editor.main', priority: 100 }],
      menus: [{ id: 'markdown-editor.open.menu', label: '打开 Markdown 文件', command: 'markdown-editor.open', location: 'file', order: 21 }],
      settings: [
        { key: 'markdown-editor.autoSave', label: '自动保存', type: 'boolean', default: false },
        { key: 'markdown-editor.showOutline', label: '显示大纲', type: 'boolean', default: true },
        { key: 'markdown-editor.showBacklinks', label: '显示反向引用', type: 'boolean', default: true },
        { key: 'markdown-editor.showFrontmatter', label: '显示 Frontmatter', type: 'boolean', default: true },
      ],
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
    id: 'classical-reading',
    name: '古文阅读',
    icon: BookOpen,
    component: ClassicalReadingPanel,
    enabled: true,
    order: 21,
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
    id: 'network-observatory', name: 'Network Observatory', icon: Network, component: NetworkObservatoryPanel, enabled: false, order: 25, keepAlive: true,
    contributions: { commands: [{ id: 'network-observatory.add', title: '添加网络目标', category: 'Network Observatory' }] },
  },
  {
    id: 'lyric-studio', name: '歌词工坊', icon: Draw, component: LyricStudioPanel, enabled: true, order: 25, keepAlive: true,
    activate: (context) => {
      context.subscriptions.add(context.commands.register('lyric-studio.generate', () => {
        window.dispatchEvent(new CustomEvent('lyric-studio:command', { detail: { command: 'generate' } }));
      }));
    },
    contributions: {
      commands: [{ id: 'lyric-studio.generate', title: 'AI 生成整首歌词', category: '歌词工坊' }],
      views: [{ id: 'lyric-studio.main', title: '歌词工坊', component: LyricStudioPanel, location: 'main' }],
      settings: [{ key: 'lyric-studio.autoSave', label: '自动保存项目', type: 'boolean', default: true }],
    },
  },
  {
    id: 'video-generation',
    name: '视频生成',
    icon: Video,
    component: VideoGenerationPanel,
    enabled: true,
    keepAlive: true,
    order: 22.5,
    preload: () => import('../video-generation'),
    activate: (context) => {
      context.subscriptions.add(context.commands.register('video-generation.open', () => {
        window.dispatchEvent(new CustomEvent('video-generation:command', { detail: { command: 'open' } }));
      }));
      context.subscriptions.add(context.commands.register('video-generation.refresh', () => {
        window.dispatchEvent(new CustomEvent('video-generation:command', { detail: { command: 'refresh' } }));
      }));
    },
    contributions: {
      commands: [
        { id: 'video-generation.open', title: '打开视频生成', category: '视频生成' },
        { id: 'video-generation.refresh', title: '刷新视频生成历史', category: '视频生成' },
      ],
    },
  },
  {
    id: 'work-browser',
    name: 'Work Browser',
    icon: WorkBrowser,
    component: WorkBrowserPanel,
    enabled: false,
    order: 9,
    keepAlive: true,
    preload: () => import('../work-browser'),
    activate: (context) => {
      context.subscriptions.add(context.commands.register('work-browser.search', () => {
        window.dispatchEvent(new CustomEvent('work-browser:command', { detail: { command: 'search' } }));
      }));
      context.subscriptions.add(context.commands.register('work-browser.save', () => {
        window.dispatchEvent(new CustomEvent('work-browser:command', { detail: { command: 'save' } }));
      }));
    },
    contributions: {
      commands: [
        { id: 'work-browser.search', title: '打开 Work Browser 搜索', category: 'Work Browser' },
        { id: 'work-browser.save', title: '保存当前页面到 Workspace', category: 'Work Browser' },
      ],
      settings: [
        { key: 'workBrowser.ai.baseUrl', label: 'AI 服务 baseUrl（OpenAI-compatible）', type: 'string', default: 'https://api.openai.com/v1' },
        { key: 'workBrowser.ai.apiKey', label: 'AI 服务 API Key', type: 'string' },
        { key: 'workBrowser.ai.model', label: 'AI 模型', type: 'string', default: 'gpt-4o-mini' },
      ],
    },
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    icon: ShieldAudit,
    component: SecurityAuditPanel,
    enabled: false,
    order: 10,
    keepAlive: true,
    preload: () => import('../security-audit'),
    activate: (context) => {
      context.subscriptions.add(context.commands.register('security-audit.run-scan', () => {
        window.dispatchEvent(new CustomEvent('security-audit:command', { detail: { command: 'run-scan' } }));
      }));
      context.subscriptions.add(context.commands.register('security-audit.open-settings', () => {
        window.dispatchEvent(new CustomEvent('security-audit:command', { detail: { command: 'open-settings' } }));
      }));
    },
    contributions: {
      commands: [
        { id: 'security-audit.run-scan', title: 'Security Scan — 扫描当前项目', category: 'Security Audit' },
        { id: 'security-audit.open-settings', title: 'Security Audit 设置', category: 'Security Audit' },
      ],
      settings: [
        { key: 'securityAudit.ai.baseUrl', label: 'AI 服务 baseUrl（OpenAI-compatible）', type: 'string', default: 'https://api.openai.com/v1' },
        { key: 'securityAudit.ai.apiKey', label: 'AI 服务 API Key', type: 'string' },
        { key: 'securityAudit.ai.model', label: 'AI 模型', type: 'string', default: 'gpt-4o-mini' },
        { key: 'securityAudit.sandboxMode', label: '执行模式（v1 仅占位，v2 实现）', type: 'string', default: 'local' },
      ],
    },
  },
  {
    id: 'video-player',
    name: '视频播放器',
    icon: Video,
    component: VideoPlayerPanel,
    enabled: false,
    order: 26,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'video-player.open', title: '打开视频文件', category: '视频播放器' },
        { id: 'video-player.toggle', title: '播放 / 暂停', category: '视频播放器' },
        { id: 'video-player.close', title: '关闭当前视频', category: '视频播放器' },
      ],
      views: [{ id: 'video-player.main', title: '视频播放器', component: VideoPlayerPanel, location: 'main' }],
      fileEditors: [{ id: 'video-player.main', extensions: ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg'], viewId: 'video-player.main', priority: 80 }],
      settings: [
        { key: 'video-player.volume', label: '默认音量', type: 'number', default: 100 },
        { key: 'video-player.hardwareDecoding', label: '硬件解码', type: 'boolean', default: true },
      ],
    },
    activate: (context) => {
      context.subscriptions.add(context.commands.register('video-player.open', () => {
        window.dispatchEvent(new CustomEvent('video-player:command', { detail: { command: 'open' } }));
      }));
      context.subscriptions.add(context.commands.register('video-player.toggle', () => {
        window.dispatchEvent(new CustomEvent('video-player:command', { detail: { command: 'toggle' } }));
      }));
      context.subscriptions.add(context.commands.register('video-player.close', () => {
        window.dispatchEvent(new CustomEvent('video-player:command', { detail: { command: 'close' } }));
      }));
    },
  },
  {
    id: 'mycast',
    name: 'MyCast',
    icon: Phone,
    component: MyCastPanel,
    enabled: true,
    order: 27,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'mycast.issuePairing', title: '生成新配对码', category: 'MyCast' },
        { id: 'mycast.refresh', title: '刷新状态', category: 'MyCast' },
      ],
    },
    activate: (context) => {
      context.subscriptions.add(context.commands.register('mycast.issuePairing', () => {
        window.dispatchEvent(new CustomEvent('mycast:command', { detail: { command: 'issuePairing' } }));
      }));
      context.subscriptions.add(context.commands.register('mycast.refresh', () => {
        window.dispatchEvent(new CustomEvent('mycast:command', { detail: { command: 'refresh' } }));
      }));
    },
  },
  {
    id: 'english-lookup',
    name: 'AI 英语查询',
    icon: Languages,
    component: EnglishLookupPanel,
    enabled: false,
    order: 11,
    keepAlive: true,
    activate: (context) => context.commands.register('english-lookup.search', () => window.dispatchEvent(new CustomEvent('english-lookup:search'))),
    contributions: {
      commands: [{ id: 'english-lookup.search', title: '查询英语单词', category: 'AI 英语查询' }],
      views: [{ id: 'english-lookup.main', title: 'AI 英语查询', component: EnglishLookupPanel, location: 'main' }],
    },
  },
  {
    id: 'phone',
    name: 'Phone',
    icon: Phone,
    component: PhonePanel,
    preload: phone.preload,
    enabled: false,
    order: 28,
    keepAlive: true,
    contributions: {
      commands: [{ id: 'phone.refresh', title: '刷新局域网设备', category: 'Phone' }],
    },
    activate: (context) => {
      void window.electronAPI.phone.start();
      context.subscriptions.add(context.commands.register('phone.refresh', () => {
        void window.electronAPI.phone.start();
      }));
      return () => { void window.electronAPI.phone.stop(); };
    },
  },
  {
    id: 'voice-input',
    name: '语音输入',
    icon: AudioLines,
    component: VoiceInputPanel,
    enabled: true,
    order: 29,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'voice-input.start', title: '开始录音', category: '语音输入' },
        { id: 'voice-input.refresh', title: '刷新状态', category: '语音输入' },
      ],
    },
    activate: (context) => {
      context.subscriptions.add(context.commands.register('voice-input.start', () => {
        window.dispatchEvent(new CustomEvent('voice-input:command', { detail: { command: 'start' } }));
      }));
      context.subscriptions.add(context.commands.register('voice-input.refresh', () => {
        window.dispatchEvent(new CustomEvent('voice-input:command', { detail: { command: 'refresh' } }));
      }));
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
  {
    id: 'rss-reader',
    name: 'RSS 阅读器',
    icon: Globe,
    component: RssReaderPanel,
    enabled: false,
    order: 28,
    keepAlive: true,
  },
  {
    id: 'zodiac-perspectives',
    name: '十二星座视角',
    icon: Sparkles,
    component: ZodiacPerspectivesPanel,
    enabled: true,
    order: 27,
    keepAlive: true,
    contributions: {
      commands: [
        { id: 'zodiac-perspectives.new', title: '新建一轮十二星座问答', category: '十二星座视角' },
        { id: 'zodiac-perspectives.openHistory', title: '查看历史与收藏', category: '十二星座视角' },
      ],
    },
  },
  {
    id: 'thinking-lab',
    name: '战略分析室',
    icon: Sparkles,
    component: ThinkingLabPanel,
    enabled: false,
    order: 28,
    keepAlive: true,
    activate: (context) => {
      context.subscriptions.add(context.commands.register('thinking-lab.new', () => window.dispatchEvent(new CustomEvent('thinking-lab:command', { detail: { command: 'new' } }))));
      context.subscriptions.add(context.commands.register('thinking-lab.history', () => window.dispatchEvent(new CustomEvent('thinking-lab:command', { detail: { command: 'history' } }))));
    },
    contributions: {
      commands: [
        { id: 'thinking-lab.new', title: '新建战略分析', category: '战略分析室' },
        { id: 'thinking-lab.history', title: '查看分析历史', category: '战略分析室' },
      ],
    },
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
    'markdown-editor': markdownEditor.preload,
    compare: compare.preload,
    'document-knowledge': documentKnowledge.preload,
    'hanyu-jinjie': hanyuJinjie.preload,
    lingohut: lingoHut.preload,
    'style-image': styleImage.preload,
    'screen-capture': screenCapture.preload,
    'disk-space': diskSpace.preload,
    'network-observatory': networkObservatory.preload,
    'lyric-studio': lyricStudio.preload,
    'video-player': videoPlayer.preload,
    mycast: mycast.preload,
    'voice-input': voiceInput.preload,
    'zodiac-perspectives': zodiacPerspectives.preload,
    'thinking-lab': thinkingLab.preload,
    'english-lookup': englishLookup.preload,
    calcpath: calcPath.preload,
    'rss-reader': rssReader.preload,
  };
  pluginRegistry.registerAll(builtInPlugins.map((plugin) => ({
    ...plugin,
    source: 'built-in',
    preload: preloadById[plugin.id],
  })));
}

export { builtInPlugins };
