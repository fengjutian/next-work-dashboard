import React, { useEffect, useMemo, useRef, useState } from 'react';
import { notification } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Check, FileText, FolderOpen, GitBranch, Loader2, Save, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { createChapterDocuments, createReadme, parseOutline, type OutlineNode, type SplitMode } from './outline';

const EXAMPLE = `# 第一篇 基础知识
## 第一章 产品介绍
### 1.1 产品背景
### 1.2 核心能力
## 第二章 快速开始
### 2.1 环境准备
### 2.2 安装与配置`;

const DEFAULT_TEMPLATE = `# {{title}}

{{placeholder}}

{{headings}}`;

const RECENT_PROJECTS_KEY = 'outline-scaffolder.recent-projects.v1';
const normalizeApiKey = (value: string) => value.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
const isValidApiKey = (value: string) => /^[\x21-\x7E]+$/.test(normalizeApiKey(value));

interface SavedProject {
  id: string;
  name: string;
  rootPath: string;
  subfolder: string;
  source: string;
  splitMode: SplitMode;
  organizeByPart: boolean;
  template: string;
  files: string[];
  updatedAt: number;
  git?: { remoteUrl: string; remoteName: string; branch: string };
  pages?: { title: string; description: string; author: string; language: string; repositoryName: string; customDomain: string; accentColor?: string };
}

function loadSavedProjects(): SavedProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, 20) : [];
  } catch { return []; }
}

function OutlineTree({ nodes }: { nodes: OutlineNode[] }) {
  return <ul className="space-y-1">
    {nodes.map((node) => <li key={node.id}>
      <div className="flex items-center gap-2 rounded px-2 py-1 text-sm text-foreground hover:bg-muted/60">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.title}</span>
      </div>
      {node.children.length > 0 && <div className="ml-5 border-l border-border pl-2"><OutlineTree nodes={node.children} /></div>}
    </li>)}
  </ul>;
}

export const OutlineScaffolderPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [notice, holder] = notification.useNotification();
  const [source, setSource] = useState(EXAMPLE);
  const [projectTitle, setProjectTitle] = useState('未命名书籍');
  const [subfolder, setSubfolder] = useState('我的文档');
  const [splitMode, setSplitMode] = useState<SplitMode>('chapter');
  const [organizeByPart, setOrganizeByPart] = useState(true);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showTemplate, setShowTemplate] = useState(false);
  const [target, setTarget] = useState<{ path: string; name: string } | null>(null);
  const [outputIsGitRepository, setOutputIsGitRepository] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<'generator' | 'documents'>('generator');
  const [managedFiles, setManagedFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');
  const [documentContent, setDocumentContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [modifiedAt, setModifiedAt] = useState<number>();
  const [documentLoading, setDocumentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recentProjects, setRecentProjects] = useState<SavedProject[]>(loadSavedProjects);
  const [projectHistoryReady, setProjectHistoryReady] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<'generate' | 'continue' | 'polish'>('generate');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBaseUrl, setReviewBaseUrl] = useState('https://api.minimaxi.com/v1');
  const [reviewApiKey, setReviewApiKey] = useState('');
  const [reviewModel, setReviewModel] = useState('MiniMax-M3');
  const [reviewInstruction, setReviewInstruction] = useState('重点检查事实、时间线、人物关系、逻辑和语言问题，并指出值得补充背景、案例、数据或解释的位置。');
  const [imageOpen, setImageOpen] = useState(false);
  const [minimaxApiKey, setMinimaxApiKey] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageAspectRatio, setImageAspectRatio] = useState('16:9');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [gitOpen, setGitOpen] = useState(false);
  const [gitChanges, setGitChanges] = useState<Array<{ path: string; status: string }>>([]);
  const [gitMessage, setGitMessage] = useState('docs: update generated articles');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState('');
  const [gitRepository, setGitRepository] = useState<boolean | null>(null);
  const [gitRemoteUrl, setGitRemoteUrl] = useState('');
  const [gitRemoteName, setGitRemoteName] = useState('origin');
  const [gitBranch, setGitBranch] = useState('main');
  const [pagesOpen, setPagesOpen] = useState(false);
  const [pagesTitle, setPagesTitle] = useState(projectTitle);
  const [pagesDescription, setPagesDescription] = useState(`${projectTitle}在线阅读`);
  const [pagesAuthor, setPagesAuthor] = useState('作者');
  const [pagesLanguage, setPagesLanguage] = useState('zh-CN');
  const [pagesRepositoryName, setPagesRepositoryName] = useState('my-book');
  const [pagesCustomDomain, setPagesCustomDomain] = useState('');
  const [pagesAccentColor, setPagesAccentColor] = useState('#6d285f');
  const aiRequestRef = useRef(0);
  const nodes = useMemo(() => parseOutline(source), [source]);
  const documents = useMemo(() => createChapterDocuments(nodes, { folder: subfolder, splitMode, organizeByPart, projectTitle, template }), [nodes, organizeByPart, projectTitle, splitMode, subfolder, template]);
  const files = useMemo(() => [...documents, createReadme(documents, projectTitle, subfolder)], [documents, projectTitle, subfolder]);

  useEffect(() => {
    let active = true;
    window.electronAPI.outlineProjects.load().then((stored) => {
      if (!active) return;
      setRecentProjects((local) => {
        const merged = new Map<string, SavedProject>();
        [...local, ...stored].forEach((project) => {
          const current = merged.get(project.id);
          if (!current || project.updatedAt > current.updatedAt) merged.set(project.id, project);
        });
        return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
      });
      setProjectHistoryReady(true);
    }).catch(() => setProjectHistoryReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    Promise.all([window.electronAPI.outlineSecrets.load('review'), window.electronAPI.outlineSecrets.load('minimax')]).then(([review, minimax]) => {
      if (review.success && review.value) setReviewApiKey(review.value);
      if (minimax.success && minimax.value) setMinimaxApiKey(minimax.value);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!projectHistoryReady) return;
    try { localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recentProjects)); } catch { /* Documents remain on disk. */ }
    window.electronAPI.outlineProjects.save(recentProjects).catch(() => undefined);
  }, [projectHistoryReady, recentProjects]);

  useEffect(() => { setConflicts([]); }, [files, target]);
  useEffect(() => {
    aiRequestRef.current += 1;
    setAiLoading(false); setAiResult(''); setAiError('');
  }, [activeFile]);

  const dirty = documentContent !== savedContent;
  const activeProject = recentProjects.find((project) => project.rootPath === target?.path && (!project.subfolder || managedFiles.some((path) => path.startsWith(`${project.subfolder}/`)))) ?? null;
  const activeProjectId = activeProject?.id;

  useEffect(() => {
    if (!activeProjectId) return;
    const timer = window.setTimeout(() => {
      setRecentProjects((current) => current.map((project) => project.id === activeProjectId ? {
        ...project,
      git: { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch },
        pages: { title: pagesTitle || projectTitle, description: pagesDescription || `${projectTitle}在线阅读`, author: pagesAuthor || '作者', language: pagesLanguage || 'zh-CN', repositoryName: pagesRepositoryName || 'my-book', customDomain: pagesCustomDomain, accentColor: pagesAccentColor },
        updatedAt: Date.now(),
      } : project));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, gitBranch, gitRemoteName, gitRemoteUrl, pagesAccentColor, pagesAuthor, pagesCustomDomain, pagesDescription, pagesLanguage, pagesRepositoryName, pagesTitle, projectTitle]);

  const switchView = (next: 'generator' | 'documents') => {
    if (next !== view && dirty && !window.confirm('当前文档尚未保存，确定离开吗？')) return;
    setView(next);
  };

  const openDocument = async (path: string, folder = target, confirmDiscard = true) => {
    if (!folder || (confirmDiscard && dirty && !window.confirm('当前文档尚未保存，确定切换吗？'))) return;
    setDocumentLoading(true);
    try {
      const result = await window.electronAPI.workspace.readTextFile(folder.path, path);
      if (!result.success || !result.data) throw new Error(result.error);
      setActiveFile(path); setDocumentContent(result.data.content); setSavedContent(result.data.content); setModifiedAt(result.data.modifiedAt);
    } catch (error) {
      notice.error({ message: '读取文档失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setDocumentLoading(false); }
  };

  const rememberProject = (folder: { path: string; name: string }, paths: string[], overrides?: Partial<SavedProject>) => {
    const requestedFolder = overrides?.subfolder ?? subfolder;
    const savedFolder = requestedFolder.trim() && paths[0]?.includes('/') ? paths[0].split('/')[0] : '';
    const project: SavedProject = {
      id: `${folder.path}::${savedFolder}`,
      name: overrides?.name ?? (projectTitle.trim() || folder.name),
      rootPath: folder.path,
      subfolder: savedFolder,
      source: overrides?.source ?? source,
      splitMode: overrides?.splitMode ?? splitMode,
      organizeByPart: overrides?.organizeByPart ?? organizeByPart,
      template: overrides?.template ?? template,
      files: paths,
      updatedAt: Date.now(),
      git: overrides?.git ?? { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch },
      pages: overrides?.pages ?? { title: pagesTitle, description: pagesDescription, author: pagesAuthor, language: pagesLanguage, repositoryName: pagesRepositoryName, customDomain: pagesCustomDomain, accentColor: pagesAccentColor },
    };
    setRecentProjects((current) => [project, ...current.filter((item) => item.id !== project.id)].slice(0, 20));
  };

  const loadExistingDocuments = async (folder = target, projectFolder = subfolder, shouldRemember = true, confirmDiscard = true) => {
    if (!folder) return;
    setDocumentLoading(true);
    try {
      const result = await window.electronAPI.workspace.listFiles(folder.path);
      if (!result.success) throw new Error(result.error);
      const prefix = projectFolder.trim() ? `${projectFolder.trim().replace(/\\/g, '/')}/` : '';
      const allMarkdown = (result.data ?? []).filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.md'))
        .map((entry) => entry.path.replace(/\\/g, '/')).filter((path) => !path.startsWith('.history/') && !path.includes('/.history/'));
      const matched = allMarkdown.filter((path) => !prefix || path.startsWith(prefix));
      const paths = (matched.length ? matched : allMarkdown).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      setManagedFiles(paths); setView('documents');
      if (shouldRemember && paths.length) rememberProject(folder, paths, { subfolder: projectFolder });
      if (paths.length) await openDocument(paths[0], folder, confirmDiscard);
      else notice.info({ message: '没有找到 Markdown 文档', placement: 'bottomRight' });
    } catch {
      notice.error({ message: '加载失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setDocumentLoading(false); }
  };

  const openSavedProject = async (project: SavedProject) => {
    if (dirty && !window.confirm('当前文档尚未保存，确定打开其他项目吗？')) return;
    try {
      const authorized = await window.electronAPI.workspace.reauthorize(project.rootPath);
      if (!authorized.success) throw new Error('目录授权失败');
      const folder = { path: project.rootPath, name: project.name };
      setTarget(folder); setProjectTitle(project.name); setSubfolder(project.subfolder); setSource(project.source);
      setSplitMode(project.splitMode); setOrganizeByPart(project.organizeByPart); setTemplate(project.template);
      setGitRemoteUrl(project.git?.remoteUrl ?? ''); setGitRemoteName(project.git?.remoteName ?? 'origin'); setGitBranch(project.git?.branch ?? 'main');
      const restoredBookTitle = !project.pages?.title || project.pages.title === '我的文档' ? (project.pages?.description?.replace(/在线阅读$/, '') || project.name) : project.pages.title;
      setPagesTitle(restoredBookTitle); setPagesDescription(project.pages?.description ?? `${restoredBookTitle}在线阅读`); setPagesAuthor(project.pages?.author ?? '作者');
      setPagesLanguage(project.pages?.language ?? 'zh-CN'); setPagesRepositoryName(project.pages?.repositoryName ?? 'my-book'); setPagesCustomDomain(project.pages?.customDomain ?? '');
      setPagesAccentColor(project.pages?.accentColor ?? '#6d285f');
      setManagedFiles(project.files); setView('documents'); setActiveFile(''); setDocumentContent(''); setSavedContent('');
      await loadExistingDocuments(folder, project.subfolder, false, false);
      setRecentProjects((current) => current.map((item) => item.id === project.id ? { ...item, updatedAt: Date.now() } : item).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (error) {
      notice.error({ message: '项目无法打开', description: '项目目录可能已移动或删除，请重新选择目录。', placement: 'bottomRight' });
    }
  };

  const removeSavedProject = (id: string) => setRecentProjects((current) => current.filter((project) => project.id !== id));

  const saveDocument = async () => {
    if (!target || !activeFile || !dirty) return;
    setSaving(true);
    try {
      if (savedContent) {
        const historyRoot = activeProject?.subfolder ? `${activeProject.subfolder}/.history` : '.history';
        const historyDirectory = await window.electronAPI.workspace.createDirectory(target.path, historyRoot);
        if (!historyDirectory.success && !/EEXIST|ALREADY_EXISTS/.test(String(historyDirectory.error))) throw new Error(historyDirectory.error);
        const snapshotName = activeFile.replace(/[/\\<>:"|?*]/g, '-').replace(/\.md$/i, '');
        const snapshot = await window.electronAPI.workspace.mutateFiles(target.path, [{ kind: 'create', path: `${historyRoot}/${Date.now()}-${snapshotName}.md`, content: savedContent, encoding: 'utf8', lineEnding: 'LF' }]);
        if (!snapshot.success) throw new Error(snapshot.error);
      }
      const result = await window.electronAPI.workspace.writeTextFile(target.path, activeFile, documentContent, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: modifiedAt });
      if (!result.success || !result.data) throw new Error(result.error);
      setSavedContent(documentContent); setModifiedAt(result.data.modifiedAt);
      notice.success({ message: '文档已保存', placement: 'bottomRight' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notice.error({ message: message.includes('FILE_MODIFIED_EXTERNALLY') ? '文件已被外部修改' : '保存失败', description: message.includes('FILE_MODIFIED_EXTERNALLY') ? '请重新加载文件，确认外部改动后再编辑。' : message, placement: 'bottomRight' });
    } finally { setSaving(false); }
  };

  const runAi = async (writeToEditor = false) => {
    if (!activeFile || aiLoading) return;
    if (!aiApi.apiKey?.trim()) { setAiError('请先在应用设置中配置 AI API Key。'); return; }
    const requestId = ++aiRequestRef.current;
    setAiLoading(true); setAiResult(''); setAiError('');
    const chapterName = activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile;
    const modePrompt = aiMode === 'generate'
      ? '根据章节标题和现有骨架撰写完整正文。保留一级标题和合理的标题层级，替换占位注释。'
      : aiMode === 'continue'
        ? '承接现有正文继续写作。不要复述已有内容，只输出新增内容。'
        : '润色现有正文，改善结构、准确性、连贯性和表达，同时保持原意与 Markdown 标题结构。输出润色后的完整正文。';
    const system = `你是一名严谨而不失风趣的专业中文作者。当前项目名为“${projectTitle}”。

写作要求：
1. 准确性优先：论点明确，概念、人物、时间和因果关系准确；不确定的信息必须使用审慎表述，禁止编造事实、数据、引文或出处。
2. 结构严密：围绕本章主题展开，段落之间有清晰的递进、转折或因果关系，避免重复、空话和偏题。
3. 解释充分：重要结论说明理由；复杂内容优先使用具体例子、类比或必要的背景信息帮助理解。
4. 语言自然：使用流畅、简洁、有节奏的现代中文，避免机械套话、过度总结和明显的 AI 腔。
5. 适度风趣：可以使用机智的比喻、轻微反差或幽默转场，但必须服务于理解；不要堆砌网络梗，不要油腔滑调，不拿严肃事件或具体群体开玩笑。
6. 风趣程度约占整体表达的 10%—15%，正文仍以专业、可信、耐读为主。
7. 保持全书章节边界，不抢写其他章节的核心内容；必要时可简短提示后文将继续讨论。
8. 直接输出可写入文件的 Markdown，不使用代码围栏，不解释创作过程，不添加“以下是正文”等开场白。`;
    const context = managedFiles.slice(0, 100).map((path) => path.split('/').pop()?.replace(/\.md$/i, '')).filter(Boolean).join('、');
    const user = `当前章节：${chapterName}\n全书章节：${context}\n任务：${modePrompt}${aiInstruction.trim() ? `\n用户补充要求：${aiInstruction.trim()}` : ''}\n\n现有文档：\n${documentContent}`;
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
      let result = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.72, maxTokens: 8_192, stream: true })) {
        if (requestId !== aiRequestRef.current) return;
        if (chunk.delta) { result += chunk.delta; setAiResult(result); }
      }
      if (!result.trim()) throw new Error('AI 没有返回内容，请重试。');
      if (writeToEditor && requestId === aiRequestRef.current) {
        const next = aiMode === 'continue' ? `${documentContent.trimEnd()}\n\n${result.trim()}\n` : `${result.trimEnd()}\n`;
        setDocumentContent(next); setEditorMode('edit'); setAiOpen(false);
        notice.success({ message: 'AI 内容已写入编辑器', description: '请确认内容后点击“保存”写入磁盘。', placement: 'bottomRight' });
      }
    } catch (error) {
      if (requestId === aiRequestRef.current) setAiError(error instanceof Error ? error.message : String(error));
    } finally { if (requestId === aiRequestRef.current) setAiLoading(false); }
  };

  const stopAi = () => { aiRequestRef.current += 1; setAiLoading(false); };

  const applyAiResult = (method: 'replace' | 'append') => {
    if (!aiResult.trim()) return;
    setDocumentContent((current) => method === 'replace' ? aiResult.trimEnd() + '\n' : `${current.trimEnd()}\n\n${aiResult.trim()}\n`);
    setAiOpen(false); setReviewOpen(false); setEditorMode('edit');
  };

  const runReview = async () => {
    if (!activeFile || aiLoading) return;
    if (!normalizeApiKey(reviewApiKey) || !reviewBaseUrl.trim() || !reviewModel.trim()) { setAiError('请完整填写审校模型地址、API Key 和模型名。'); return; }
    if (!isValidApiKey(reviewApiKey)) { setAiError('API Key 含有中文、空格或其他无效字符。请清空后从 MiniMax 控制台重新复制完整 Key。'); return; }
    const requestId = ++aiRequestRef.current;
    setAiLoading(true); setAiResult(''); setAiError('');
    const messages: ChatMessage[] = [
      { role: 'system', content: `你是独立于作者的资深中文责任编辑、事实核查员和内容策划。你的任务是审阅文章并提交“审校报告”，不要重写全文。\n\n请严格使用以下 Markdown 结构：\n# 审校结论\n用 2—4 句话概括完成度、主要优点和最需要处理的问题。\n\n## 一、明确错误与修改建议\n按严重程度排序。每项必须包含：\n- **位置**：引用能唯一定位问题的原文短句，不超过 30 字；\n- **类型**：事实、时间线、人物关系、逻辑、术语、语病、错别字或标点；\n- **问题**：说明为什么有错或存在风险；\n- **建议**：给出具体修改方向；能确定时提供一句建议改法，不能确定时明确标记“需人工核实”。\n若没有明确错误，写“未发现明确错误”，不得为了凑数虚构问题。\n\n## 二、可能存疑、需要核实\n列出原文中的数字、日期、引语、因果判断和历史细节等高风险表述。区分“疑似错误”和“原文缺少依据”，不要把不确定内容武断判错。\n\n## 三、值得扩写的地方\n每项必须包含：\n- **位置**：对应标题或原文短句；\n- **为什么值得扩写**：它对读者理解有什么帮助；\n- **扩写方向**：建议补充的背景、案例、数据、对比、人物动机或因果链；\n- **建议篇幅**：例如 100—200 字。\n扩写必须服务于本章主题，不抢写其他章节，不重复已有内容。\n\n## 四、结构与表达建议\n指出段落顺序、衔接、重复、节奏、标题层级及风趣程度的问题。\n\n## 五、处理优先级\n分为“必须修改”“建议修改”“可选扩写”三个清单。\n\n审校原则：准确优先；证据不足就明确说不足；不编造事实、来源或引文；意见必须具体、可执行；只输出审校报告，不输出修改后的全文。` },
      { role: 'user', content: `书名：${projectTitle}\n章节：${activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile}\n用户关注点：${reviewInstruction.trim()}\n\n请审阅以下文章：\n\n${documentContent}` },
    ];
    try {
      const provider = createOpenAIProvider({ apiKey: normalizeApiKey(reviewApiKey), baseUrl: reviewBaseUrl.trim(), chatProxy: window.electronAPI.llmChat });
      let result = '';
      for await (const chunk of provider.chat(messages, { model: reviewModel.trim(), temperature: 0.35, maxTokens: 8_192, stream: false })) {
        if (requestId !== aiRequestRef.current) return;
        if (chunk.delta) { result += chunk.delta; setAiResult(result); }
      }
      if (!result.trim()) throw new Error('审校模型没有返回内容，请检查模型配置。');
    } catch (error) {
      if (requestId === aiRequestRef.current) {
        const message = error instanceof Error ? error.message : String(error);
        setAiError(/401|invalid api key|authorized_error/i.test(message)
          ? `API Key 未通过当前平台鉴权。当前请求地址：${reviewBaseUrl.includes('minimaxi.com') ? '国内站 api.minimaxi.com' : '全球站 api.minimax.io'}。请确认 Key 来自同一平台的“账户管理 → 接口密钥”，而不是 Token Plan 兑换码或网页登录凭据。`
          : /529|2064|overloaded_error|负载较高/i.test(message)
            ? 'MiniMax M3 当前负载较高；系统已自动重试 3 次仍未成功。请稍后再次点击审校，或临时切换到 MiniMax-M2.7。'
            : message);
      }
    } finally { if (requestId === aiRequestRef.current) setAiLoading(false); }
  };

  const generateIllustration = async () => {
    if (imageLoading || !activeFile) return;
    if (!normalizeApiKey(minimaxApiKey) || !imagePrompt.trim()) { setImageError('请填写 MiniMax API Key 和插图描述。'); return; }
    if (!isValidApiKey(minimaxApiKey)) { setImageError('API Key 含有中文、空格或其他无效字符。请清空后从 MiniMax 控制台重新复制完整 Key。'); return; }
    setImageLoading(true); setImageDataUrl(''); setImageError('');
    try {
      const chapterName = activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile;
      const result = await window.electronAPI.generateImage({ provider: 'minimax', baseUrl: reviewBaseUrl.includes('minimaxi.com') ? 'https://api.minimaxi.com/v1' : 'https://api.minimax.io/v1', apiKey: normalizeApiKey(minimaxApiKey), model: 'image-01', prompt: `为《${projectTitle}》的章节“${chapterName}”创作一幅出版级配图。${imagePrompt.trim()}。画面完整，构图清晰，不出现文字、水印、标识或界面元素。`, size: '1024x1024', quality: 'standard', aspectRatio: imageAspectRatio, promptOptimizer: true, aigcWatermark: false });
      if (!result.success || !result.imageDataUrl) throw new Error(result.error || 'MiniMax 没有返回图片。');
      setImageDataUrl(result.imageDataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageError(/401|invalid api key|authorized_error/i.test(message) ? 'MiniMax API Key 无效或区域不匹配，请重新复制完整 Key 后再试。' : message);
    }
    finally { setImageLoading(false); }
  };

  const saveApiKey = async (kind: 'review' | 'minimax', value: string) => {
    if (!isValidApiKey(value)) {
      notice.error({ message: 'API Key 格式无效', description: 'Key 只能包含 ASCII 字符。请勿填写“无”“未配置”等说明文字。', placement: 'bottomRight' });
      return;
    }
    const result = await window.electronAPI.outlineSecrets.save(kind, normalizeApiKey(value));
    if (result.success) notice.success({ message: 'API Key 已加密保存', description: '密钥由系统安全存储保护，不会写入项目或 Git。', placement: 'bottomRight' });
    else notice.error({ message: 'API Key 保存失败', description: result.error, placement: 'bottomRight' });
  };

  const clearApiKey = async (kind: 'review' | 'minimax') => {
    const result = await window.electronAPI.outlineSecrets.save(kind, '');
    if (kind === 'review') setReviewApiKey(''); else setMinimaxApiKey('');
    if (result.success) notice.success({ message: '已清除保存的 API Key', placement: 'bottomRight' });
    else notice.error({ message: '清除失败', description: result.error, placement: 'bottomRight' });
  };

  const saveAndInsertIllustration = async () => {
    if (!target || !activeFile || !imageDataUrl) return;
    try {
      const projectFolder = activeProject?.subfolder || (activeFile.includes('/') ? activeFile.split('/')[0] : '');
      const assetFolder = projectFolder ? `${projectFolder}/assets/images` : 'assets/images';
      const parts = assetFolder.split('/');
      for (let index = 1; index <= parts.length; index += 1) {
        const created = await window.electronAPI.workspace.createDirectory(target.path, parts.slice(0, index).join('/'));
        if (!created.success && !/EEXIST|ALREADY_EXISTS/.test(String(created.error))) throw new Error(created.error);
      }
      const stem = (activeFile.split('/').pop() || 'chapter').replace(/\.md$/i, '').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || 'chapter';
      const imagePath = `${assetFolder}/${stem}-${Date.now()}.jpg`;
      const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
      const written = await window.electronAPI.workspace.writeBinaryFile(target.path, imagePath, base64);
      if (!written.success) throw new Error(written.error);
      const from = activeFile.split('/').slice(0, -1);
      const to = imagePath.split('/');
      let common = 0;
      while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
      const relativePath = `${'../'.repeat(from.length - common)}${to.slice(common).join('/')}`;
      const alt = imagePrompt.trim().replace(/[\[\]]/g, '').slice(0, 80) || '章节插图';
      setDocumentContent((current) => `${current.trimEnd()}\n\n![${alt}](${relativePath})\n`);
      setImageOpen(false); setEditorMode('edit');
      notice.success({ message: '插图已保存并插入', description: imagePath, placement: 'bottomRight' });
    } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
  };

  const getProjectGitChanges = async () => {
    if (!target) return [];
      const result = await window.electronAPI.workspace.gitStatus(target.path);
      if (!result.success) throw new Error(result.error);
      setGitRepository(true);
      setOutputIsGitRepository(true);
      const prefix = activeProject?.subfolder || (subfolder.trim() && managedFiles[0]?.includes('/') ? managedFiles[0].split('/')[0] : '');
      const known = new Set([...managedFiles, prefix ? `${prefix}/README.md` : 'README.md', prefix ? `${prefix}/index.md` : 'index.md', prefix ? `${prefix}/404.md` : '404.md', prefix ? `${prefix}/_config.yml` : '_config.yml', prefix ? `${prefix}/.chapter-project.json` : '.chapter-project.json', prefix ? `${prefix}/_layouts/default.html` : '_layouts/default.html', prefix ? `${prefix}/_layouts/article.html` : '_layouts/article.html', prefix ? `${prefix}/_layouts/home.html` : '_layouts/home.html', prefix ? `${prefix}/assets/css/reader.css` : 'assets/css/reader.css', '.github/workflows/pages.yml']);
      const changes = (result.data ?? []).map((item) => ({ ...item, path: item.path.replace(/\\/g, '/') }))
        .filter((item) => !item.path.startsWith('.history/') && !item.path.includes('/.history/'))
        .filter((item) => prefix ? item.path.startsWith(`${prefix}/`) || item.path === '.github/workflows/pages.yml' : known.has(item.path) || item.path.startsWith('assets/images/'));
      return changes;
  };

  const persistDeploymentSettings = () => {
    if (!target || !managedFiles.length) return;
    rememberProject(target, managedFiles, {
        git: { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch },
      pages: { title: pagesTitle || projectTitle, description: pagesDescription || `${projectTitle}在线阅读`, author: pagesAuthor || '作者', language: pagesLanguage || 'zh-CN', repositoryName: pagesRepositoryName || 'my-book', customDomain: pagesCustomDomain, accentColor: pagesAccentColor },
    });
  };

  const refreshGit = async () => {
    if (!target) return;
    setGitLoading(true); setGitError('');
    try {
      setGitChanges(await getProjectGitChanges());
      const overview = await window.electronAPI.workspace.gitOperation<{ branch: string; remotes: string[] }>(target.path, 'overview');
      if (overview.success && overview.data) {
        if (overview.data.branch) setGitBranch(overview.data.branch);
        const firstRemote = overview.data.remotes?.find((line) => /\(fetch\)$/.test(line));
        const match = firstRemote?.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
        if (match) {
          setGitRemoteName(match[1]); setGitRemoteUrl(match[2]);
          const repository = match[2].split(/[/:]/).pop()?.replace(/\.git$/i, '');
          if (repository) setPagesRepositoryName(repository);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitChanges([]); setGitRepository(/not a git repository/i.test(message) ? false : null); setGitError(`当前输出目录不是可用的 Git 仓库：${message}`);
    } finally { setGitLoading(false); }
  };

  const initializeGit = async () => {
    if (!target) return;
    setGitLoading(true); setGitError('');
    try {
      const result = await window.electronAPI.workspace.gitInit(target.path);
      if (!result.success) throw new Error(result.error);
      setGitRepository(true);
      setOutputIsGitRepository(true);
      notice.success({ message: 'Git 仓库初始化成功', description: target.path, placement: 'bottomRight' });
      await refreshGit();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
    } finally { setGitLoading(false); }
  };

  const toggleGit = () => {
    const next = !gitOpen;
    setGitOpen(next); setAiOpen(false);
    if (next) refreshGit();
  };

  const commitToGit = async () => {
    if (!target || !gitChanges.length || !gitMessage.trim()) return;
    if (dirty) { setGitError('当前文档尚未保存，请先保存后再提交。'); return; }
    setGitLoading(true); setGitError('');
    try {
      const paths = gitChanges.map((change) => change.path);
      const staged = await window.electronAPI.workspace.gitStage(target.path, paths);
      if (!staged.success) throw new Error(staged.error);
      const committed = await window.electronAPI.workspace.gitCommit(target.path, gitMessage.trim(), paths);
      if (!committed.success) throw new Error(committed.error);
      notice.success({ message: '文章已提交到 Git 仓库', description: committed.data?.split('\n')[0], placement: 'bottomRight' });
      await refreshGit();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
    } finally { setGitLoading(false); }
  };

  const publishToRemote = async () => {
    if (!target || !gitRemoteUrl.trim() || !gitRemoteName.trim() || !gitBranch.trim()) return;
    if (/^https?:\/\/[^/@]+@/i.test(gitRemoteUrl.trim())) { setGitError('远程地址中不要包含用户名、Token 或密码，请使用 Git Credential Manager。'); return; }
    if (dirty) { setGitError('当前文档尚未保存，请先保存后再发布。'); return; }
    setGitLoading(true); setGitError('');
    try {
      if (gitRepository !== true) {
        const initialized = await window.electronAPI.workspace.gitInit(target.path);
        if (!initialized.success) throw new Error(initialized.error);
        setGitRepository(true); setOutputIsGitRepository(true);
      }
      const changes = await getProjectGitChanges();
      if (changes.length) {
        const paths = changes.map((change) => change.path);
        const staged = await window.electronAPI.workspace.gitStage(target.path, paths);
        if (!staged.success) throw new Error(staged.error);
        const committed = await window.electronAPI.workspace.gitCommit(target.path, gitMessage.trim() || 'docs: publish generated articles', paths);
        if (!committed.success) throw new Error(committed.error);
      }
      const overview = await window.electronAPI.workspace.gitOperation<{ branch: string; remotes: string[] }>(target.path, 'overview');
      if (!overview.success) throw new Error(overview.error);
      const remotePrefix = `${gitRemoteName.trim()}\t`;
      const remoteLines = overview.data?.remotes?.filter((line) => line.startsWith(remotePrefix)) ?? [];
      if (!remoteLines.length) {
        const added = await window.electronAPI.workspace.gitOperation(target.path, 'addRemote', { name: gitRemoteName.trim(), url: gitRemoteUrl.trim() });
        if (!added.success) throw new Error(added.error);
      } else if (!remoteLines.some((line) => line.includes(gitRemoteUrl.trim()))) {
        throw new Error(`远程名称“${gitRemoteName.trim()}”已经指向其他地址，请更换远程名称。`);
      }
      const currentBranch = overview.data?.branch;
      if (currentBranch && currentBranch !== gitBranch.trim()) {
        const renamed = await window.electronAPI.workspace.gitOperation(target.path, 'renameBranch', { from: currentBranch, to: gitBranch.trim() });
        if (!renamed.success) throw new Error(renamed.error);
      }
      const pushed = await window.electronAPI.workspace.gitOperation(target.path, 'push', { remote: gitRemoteName.trim(), setUpstream: true });
      if (!pushed.success) throw new Error(pushed.error);
      notice.success({ message: '文章已提交并推送', description: `${gitRemoteName.trim()}/${gitBranch.trim()}`, placement: 'bottomRight' });
      persistDeploymentSettings();
      setGitChanges(await getProjectGitChanges());
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
    } finally { setGitLoading(false); }
  };

  const upsertWorkspaceFile = async (path: string, content: string) => {
    if (!target) throw new Error('请先选择 Git 仓库');
    const existing = await window.electronAPI.workspace.readTextFile(target.path, path);
    if (existing.success && existing.data) {
      const updated = await window.electronAPI.workspace.writeTextFile(target.path, path, content, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: existing.data.modifiedAt });
      if (!updated.success) throw new Error(updated.error);
      return;
    }
    const created = await window.electronAPI.workspace.mutateFiles(target.path, [{ kind: 'create', path, content, encoding: 'utf8', lineEnding: 'LF' }]);
    if (!created.success) throw new Error(created.error);
  };

  const configureGitHubPages = async () => {
    if (!target || !managedFiles.length) return;
    if (dirty) { setGitError('当前文档尚未保存，请先保存后再生成 Pages 配置。'); return; }
    setGitLoading(true); setGitError('');
    try {
      const siteFolder = activeProject?.subfolder || (subfolder.trim() && managedFiles[0]?.includes('/') ? managedFiles[0].split('/')[0] : '');
      const inSite = (name: string) => siteFolder ? `${siteFolder}/${name}` : name;
      const bookTitle = pagesTitle.trim() && pagesTitle.trim() !== '我的文档' ? pagesTitle.trim() : (pagesDescription.trim().replace(/在线阅读$/, '') || projectTitle);
      const chapterFiles = managedFiles.filter((path) => path.toLowerCase().endsWith('.md') && !/README\.md$/i.test(path));
      for (const [order, file] of chapterFiles.entries()) {
        const read = await window.electronAPI.workspace.readTextFile(target.path, file);
        if (!read.success || !read.data) continue;
        const title = file.split('/').pop()?.replace(/\.md$/i, '').replace(/^\d+-/, '') ?? '文章';
        const body = read.data.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n+/, '').replace(/^#\s+.*\r?\n+/, '');
        const content = `---\nlayout: article\ntitle: ${JSON.stringify(title)}\nchapter: true\norder: ${order + 1}\n---\n\n${body}`;
        const updated = await window.electronAPI.workspace.writeTextFile(target.path, file, content, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: read.data.modifiedAt });
        if (!updated.success) throw new Error(updated.error);
      }
      const baseUrl = pagesRepositoryName.trim() ? `/${pagesRepositoryName.trim().replace(/^\/+|\/+$/g, '')}` : '';
      const config = `title: ${JSON.stringify(pagesTitle.trim() || projectTitle)}\ndescription: ${JSON.stringify(pagesDescription.trim())}\nauthor: ${JSON.stringify(pagesAuthor.trim())}\nlang: ${JSON.stringify(pagesLanguage.trim() || 'zh-CN')}\nbaseurl: ${JSON.stringify(baseUrl)}\nurl: ${JSON.stringify(pagesCustomDomain.trim() ? `https://${pagesCustomDomain.trim().replace(/^https?:\/\//, '')}` : '')}\nplugins:\n  - jekyll-feed\n  - jekyll-seo-tag\nexclude:\n  - .history\n  - .chapter-project.json\n`;
      const index = `---\nlayout: home\ntitle: ${JSON.stringify(pagesTitle.trim() || projectTitle)}\n---\n\n${pagesDescription.trim() || `${projectTitle}在线阅读`}\n`;
      const notFound = `---\nlayout: default\ntitle: 页面未找到\npermalink: /404.html\n---\n\n# 页面未找到\n\n这页似乎比作者先下班了。请返回[首页]({{ site.baseurl }}/)。\n`;
      const resolvedConfig = config.replace(JSON.stringify(pagesTitle.trim() || projectTitle), JSON.stringify(bookTitle));
      const resolvedIndex = index.replace(JSON.stringify(pagesTitle.trim() || projectTitle), JSON.stringify(bookTitle));
      const defaultLayout = `<!doctype html>\n<html lang="{{ site.lang | default: 'zh-CN' }}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  {% seo %}\n  {% feed_meta %}\n  <link rel="stylesheet" href="{{ '/assets/css/reader.css' | relative_url }}">\n</head>\n<body>\n  <header class="mobile-header"><a href="{{ '/' | relative_url }}">{{ site.title }}</a><button onclick="document.body.classList.toggle('nav-open')" aria-label="切换目录">目录</button></header>\n  <div class="book-shell">\n    <aside class="book-nav">\n      <a class="brand" href="{{ '/' | relative_url }}"><span class="brand-mark">阅</span><span><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span></a>\n      <nav><div class="nav-label">章节目录</div><ol>{% assign chapters = site.pages | where: 'chapter', true | sort: 'order' %}{% for chapter in chapters %}<li><a href="{{ chapter.url | relative_url }}" {% if page.url == chapter.url %}class="active"{% endif %}><span>{{ chapter.order | prepend: '0' | slice: -2, 2 }}</span>{{ chapter.title }}</a></li>{% endfor %}</ol></nav>\n      <footer>{{ site.author }} · {{ 'now' | date: '%Y' }}</footer>\n    </aside>\n    <main class="book-main">{{ content }}</main>\n  </div>\n</body>\n</html>\n`;
      const collapsibleLayout = defaultLayout
        .replace('<aside class="book-nav">\n      <a class="brand"', '<aside class="book-nav">\n      <button class="nav-toggle" onclick="toggleBookNav()" title="折叠或展开章节目录" aria-label="折叠或展开章节目录">‹</button>\n      <a class="brand"')
        .replace('<span><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span>', '<span class="brand-copy"><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span>')
        .replace('</span>{{ chapter.title }}</a>', '</span><b>{{ chapter.title }}</b></a>')
        .replace('  </div>\n</body>', `  </div>\n  <script>const navKey='book-nav-collapsed';if(localStorage.getItem(navKey)==='1')document.body.classList.add('nav-collapsed');function toggleBookNav(){document.body.classList.toggle('nav-collapsed');localStorage.setItem(navKey,document.body.classList.contains('nav-collapsed')?'1':'0')}</script>\n</body>`);
      const articleLayout = `---\nlayout: default\n---\n<article class="reading"><div class="eyebrow">第 {{ page.order }} 章</div><h1>{{ page.title }}</h1><div class="divider"></div>{{ content }}</article>\n`;
      const homeLayout = `---\nlayout: default\n---\n<section class="hero"><span class="hero-kicker">在线阅读</span><h1>{{ site.title }}</h1><p>{{ content | strip_html }}</p><a class="start-reading" href="{{ site.pages | where: 'chapter', true | sort: 'order' | map: 'url' | first | relative_url }}">开始阅读 →</a></section><section class="chapter-section"><div class="section-heading"><span>CONTENTS</span><h2>章节目录</h2></div><div class="chapter-grid">{% assign chapters = site.pages | where: 'chapter', true | sort: 'order' %}{% for chapter in chapters %}<a class="chapter-card" href="{{ chapter.url | relative_url }}"><span>{{ chapter.order | prepend: '0' | slice: -2, 2 }}</span><h3>{{ chapter.title }}</h3><em>阅读本章 →</em></a>{% endfor %}</div></section>\n`;
      const accent = /^#[0-9a-f]{6}$/i.test(pagesAccentColor) ? pagesAccentColor : '#6d285f';
      const css = `:root{--accent:${accent};--accent-soft:color-mix(in srgb,var(--accent) 10%,white);--paper:#fbfaf8;--ink:#252220;--muted:#766f69;--line:#e7e1dc;--nav:300px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",serif;-webkit-font-smoothing:antialiased}.book-shell{min-height:100vh}.book-nav{position:fixed;inset:0 auto 0 0;width:var(--nav);display:flex;flex-direction:column;padding:32px 22px;background:#fff;border-right:1px solid var(--line);overflow:auto}.brand{display:flex;gap:13px;align-items:center;color:inherit;text-decoration:none}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--accent);color:#fff;font-size:20px}.brand strong,.brand small{display:block}.brand strong{font-size:18px}.brand small{max-width:180px;margin-top:3px;color:var(--muted);font:12px/1.4 system-ui,sans-serif}.book-nav nav{margin-top:42px}.nav-label{margin:0 10px 12px;color:#aaa;font:600 11px system-ui,sans-serif;letter-spacing:.16em}.book-nav ol{margin:0;padding:0;list-style:none}.book-nav li a{display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:9px;color:#514b47;text-decoration:none;font:14px/1.45 system-ui,sans-serif}.book-nav li a span{color:#aaa;font-size:11px}.book-nav li a:hover,.book-nav li a.active{background:var(--accent-soft);color:var(--accent)}.book-nav footer{margin-top:auto;padding:28px 10px 0;color:#aaa;font:11px system-ui,sans-serif}.book-main{margin-left:var(--nav);min-height:100vh}.reading{max-width:820px;margin:0 auto;padding:80px 56px 120px}.reading .eyebrow,.hero-kicker{color:var(--accent);font:600 12px system-ui,sans-serif;letter-spacing:.18em}.reading h1{margin:12px 0 22px;font-size:42px;line-height:1.25}.divider{width:52px;height:3px;margin-bottom:46px;background:var(--accent)}.reading h2{margin:2.2em 0 .8em;font-size:26px}.reading h3{margin:1.8em 0 .7em;font-size:20px}.reading p,.reading li{font-size:18px;line-height:2;text-align:justify}.reading blockquote{margin:2em 0;padding:18px 24px;border-left:3px solid var(--accent);background:var(--accent-soft);color:#514b47}.reading img{max-width:100%;border-radius:12px}.reading code{padding:.15em .4em;border-radius:5px;background:#f0ece8;font-family:ui-monospace,monospace}.hero{padding:110px max(7vw,50px) 80px;background:radial-gradient(circle at 85% 10%,var(--accent-soft),transparent 34%),#fff;border-bottom:1px solid var(--line)}.hero h1{max-width:850px;margin:16px 0 20px;font-size:clamp(42px,6vw,76px);line-height:1.08}.hero p{max-width:680px;color:var(--muted);font-size:18px;line-height:1.8}.start-reading{display:inline-block;margin-top:24px;padding:13px 22px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font:600 14px system-ui,sans-serif}.chapter-section{padding:70px max(5vw,42px) 100px}.section-heading span{color:var(--accent);font:600 11px system-ui,sans-serif;letter-spacing:.2em}.section-heading h2{margin:8px 0 30px;font-size:32px}.chapter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.chapter-card{min-height:160px;padding:24px;border:1px solid var(--line);border-radius:16px;background:#fff;color:inherit;text-decoration:none;transition:.2s}.chapter-card:hover{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 14px 35px rgba(45,33,27,.08)}.chapter-card>span{color:var(--accent);font:600 12px system-ui,sans-serif}.chapter-card h3{margin:18px 0 28px;font-size:19px}.chapter-card em{color:var(--muted);font:normal 12px system-ui,sans-serif}.mobile-header{display:none}@media(prefers-color-scheme:dark){:root{--paper:#191817;--ink:#eee9e4;--muted:#aaa29b;--line:#393532}.book-nav,.hero,.chapter-card{background:#211f1d}.reading code{background:#2d2926}}@media(max-width:840px){.mobile-header{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;padding:14px 18px;background:color-mix(in srgb,var(--paper) 92%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.mobile-header a{color:inherit;text-decoration:none;font-weight:700}.mobile-header button{border:0;background:none;color:var(--accent)}.book-nav{z-index:30;transform:translateX(-102%);transition:.25s;box-shadow:12px 0 40px rgba(0,0,0,.12)}.nav-open .book-nav{transform:none}.book-main{margin-left:0}.reading{padding:54px 24px 90px}.reading h1{font-size:34px}.reading p,.reading li{font-size:17px;line-height:1.9}.hero{padding:70px 24px 60px}.chapter-section{padding:48px 20px 80px}}`;
      const collapseCss = `.nav-toggle{position:absolute;top:24px;right:14px;width:28px;height:28px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--accent);cursor:pointer;font-size:22px;line-height:22px;transition:.2s}.nav-collapsed .book-nav{width:78px;padding-inline:12px}.nav-collapsed .book-main{margin-left:78px}.nav-collapsed .brand{justify-content:center}.nav-collapsed .brand-copy,.nav-collapsed .nav-label,.nav-collapsed .book-nav li a b,.nav-collapsed .book-nav footer{display:none}.nav-collapsed .book-nav li a{justify-content:center;padding:10px 4px}.nav-collapsed .book-nav li a span{font-size:12px}.nav-collapsed .nav-toggle{right:8px;transform:rotate(180deg)}@media(max-width:840px){.nav-toggle{display:none}.nav-collapsed .book-nav{width:var(--nav);padding:32px 22px}.nav-collapsed .book-main{margin-left:0}.nav-collapsed .brand-copy,.nav-collapsed .nav-label,.nav-collapsed .book-nav li a b,.nav-collapsed .book-nav footer{display:block}.nav-collapsed .book-nav li a{justify-content:flex-start;padding:9px 10px}}`;
      const togglePositionCss = `.nav-toggle,.nav-collapsed .nav-toggle{right:-14px;z-index:2}.nav-collapsed .nav-toggle{transform:rotate(180deg)}`;
      for (const directory of [inSite('_layouts'), inSite('assets'), inSite('assets/css')]) {
        const created = await window.electronAPI.workspace.createDirectory(target.path, directory);
        if (!created.success && !/EEXIST|ALREADY_EXISTS/.test(String(created.error))) throw new Error(created.error);
      }
      await upsertWorkspaceFile(inSite('_config.yml'), resolvedConfig);
      await upsertWorkspaceFile(inSite('index.md'), resolvedIndex);
      await upsertWorkspaceFile(inSite('404.md'), notFound);
      await upsertWorkspaceFile(inSite('_layouts/default.html'), collapsibleLayout);
      await upsertWorkspaceFile(inSite('_layouts/article.html'), articleLayout);
      await upsertWorkspaceFile(inSite('_layouts/home.html'), homeLayout);
      await upsertWorkspaceFile(inSite('assets/css/reader.css'), css + collapseCss + togglePositionCss);
      for (const directory of ['.github', '.github/workflows']) {
        const created = await window.electronAPI.workspace.createDirectory(target.path, directory);
        if (!created.success && !/EEXIST|ALREADY_EXISTS/.test(String(created.error))) throw new Error(created.error);
      }
      const source = siteFolder ? `./${siteFolder}` : './';
      const workflow = `name: Deploy GitHub Pages\n\non:\n  push:\n    branches: [${gitBranch.trim() || 'main'}]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n  pages: write\n  id-token: write\n\nconcurrency:\n  group: pages\n  cancel-in-progress: false\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v6\n      - name: Setup Pages\n        uses: actions/configure-pages@v5\n      - name: Build with Jekyll\n        uses: actions/jekyll-build-pages@v1\n        with:\n          source: ${JSON.stringify(source)}\n          destination: ./_site\n      - name: Upload artifact\n        uses: actions/upload-pages-artifact@v4\n\n  deploy:\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    runs-on: ubuntu-latest\n    needs: build\n    steps:\n      - name: Deploy\n        id: deployment\n        uses: actions/deploy-pages@v4\n`;
      await upsertWorkspaceFile('.github/workflows/pages.yml', workflow);
      if (activeFile) await openDocument(activeFile, target, false);
      notice.success({ message: 'GitHub Pages 配置已生成', description: '提交并推送后，请在仓库 Settings → Pages 中选择 GitHub Actions。', placement: 'bottomRight' });
      persistDeploymentSettings();
      setGitChanges(await getProjectGitChanges());
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
    } finally { setGitLoading(false); }
  };

  const chooseFolder = async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (folder) { setTarget(folder); setOutputIsGitRepository(null); }
  };

  const chooseGitOutput = async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (!folder) return;
    setTarget(folder); setGitLoading(true); setGitError('');
    try {
      const status = await window.electronAPI.workspace.gitStatus(folder.path);
      if (!status.success) throw new Error(status.error);
      setOutputIsGitRepository(true); setGitRepository(true);
      notice.success({ message: '已选择 Git 仓库', description: `文章将生成到 ${folder.path}`, placement: 'bottomRight' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutputIsGitRepository(false); setGitRepository(/not a git repository/i.test(message) ? false : null);
      notice.warning({ message: '所选目录尚不是 Git 仓库', description: '可以初始化该目录，然后直接生成文档。', placement: 'bottomRight' });
    } finally { setGitLoading(false); }
  };

  const checkExisting = async (): Promise<string[]> => {
    if (!target) return [];
    setChecking(true);
    try {
      const byDirectory = new Map<string, Set<string>>();
      for (const file of files) {
        const parts = file.path.split('/');
        const name = parts.pop()!;
        const directory = parts.join('/');
        if (!byDirectory.has(directory)) byDirectory.set(directory, new Set());
        byDirectory.get(directory)!.add(name);
      }
      const found: string[] = [];
      for (const [directory, names] of byDirectory) {
        const result = await window.electronAPI.workspace.listDirectory(target.path, directory);
        if (!result.success) continue;
        for (const entry of result.data ?? []) if (entry.type === 'file' && names.has(entry.name)) found.push(directory ? `${directory}/${entry.name}` : entry.name);
      }
      setConflicts(found);
      return found;
    } finally { setChecking(false); }
  };

  const ensureDirectories = async () => {
    if (!target) return;
    const directories = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/'); parts.pop();
      let current = '';
      for (const part of parts) { current = current ? `${current}/${part}` : part; directories.add(current); }
    }
    for (const directory of directories) {
      const result = await window.electronAPI.workspace.createDirectory(target.path, directory);
      if (!result.success && !/EEXIST|ALREADY_EXISTS/.test(String(result.error))) throw new Error(result.error);
    }
  };

  const generate = async () => {
    if (!target || documents.length === 0) return;
    setCreating(true);
    try {
      const existing = await checkExisting();
      if (existing.length) throw new Error(`ALREADY_EXISTS:${existing[0]}`);
      await ensureDirectories();
      for (let index = 0; index < files.length; index += 200) {
        const result = await window.electronAPI.workspace.mutateFiles(target.path, files.slice(index, index + 200).map((file) => ({
          kind: 'create' as const, path: file.path, content: file.content, encoding: 'utf8' as const, lineEnding: 'LF' as const,
        })));
        if (!result.success) throw new Error(result.error);
      }
      notice.success({ message: '文档骨架创建完成', description: `已创建 ${documents.length} 个章节文档和 README.md。`, placement: 'bottomRight' });
      const paths = documents.map((document) => document.path);
      const outputFolder = subfolder.trim() && documents[0]?.path.includes('/') ? documents[0].path.split('/')[0] : '';
      const manifestPath = outputFolder ? `${outputFolder}/.chapter-project.json` : '.chapter-project.json';
      const manifest = JSON.stringify({ version: 1, name: projectTitle, source, splitMode, organizeByPart, template, files: paths, updatedAt: Date.now() }, null, 2) + '\n';
      const manifestResult = await window.electronAPI.workspace.mutateFiles(target.path, [{ kind: 'create', path: manifestPath, content: manifest, encoding: 'utf8', lineEnding: 'LF' }]);
      if (!manifestResult.success && String(manifestResult.error).includes('ALREADY_EXISTS')) {
        const updated = await window.electronAPI.workspace.writeTextFile(target.path, manifestPath, manifest, { encoding: 'utf8', lineEnding: 'LF', force: true });
        if (!updated.success) throw new Error(updated.error);
      } else if (!manifestResult.success) throw new Error(manifestResult.error);
      setManagedFiles(paths); setView('documents');
      rememberProject(target, paths);
      if (paths.length) await openDocument(paths[0], target, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notice.error({ message: '创建失败', description: message.includes('ALREADY_EXISTS') ? '目标中已有同名文件。为保护原内容，本次没有覆盖，请更换子目录名称。' : message, placement: 'bottomRight' });
    } finally { setCreating(false); }
  };

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    {holder}
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div><h1 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5" />章节文档生成器</h1><p className="mt-1 text-sm text-muted-foreground">粘贴目录，批量创建可自行填写的 Markdown 文档。</p></div>
      <div className="flex items-center gap-2">{activeProject && <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700" title={activeProject.rootPath}>项目已保存</div>}<Button size="sm" variant={view === 'generator' ? 'default' : 'ghost'} onClick={() => switchView('generator')}>生成器</Button><Button size="sm" variant={view === 'documents' ? 'default' : 'ghost'} onClick={() => switchView('documents')}>文档工作区</Button><div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{documents.length} 个文档</div></div>
    </header>
    {view === 'generator' ? <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-auto p-6 lg:grid-cols-[minmax(380px,1.15fr)_minmax(300px,.85fr)]">
      <section className="flex min-h-[520px] flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <label className="mb-2 text-sm font-medium">章节目录</label>
        <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} className="min-h-[420px] flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="支持 Markdown 标题、第一章/第一节和数字编号目录" />
        <p className="mt-2 text-xs text-muted-foreground">默认按“章”创建文件，其下小节成为文档内标题。</p>
      </section>
      <div className="flex min-h-0 flex-col gap-5">
        {recentProjects.length > 0 && <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">最近项目</h2><span className="text-xs text-muted-foreground">{recentProjects.length}</span></div><div className="max-h-36 space-y-1 overflow-auto">{recentProjects.map((project) => <div key={project.id} className="group flex items-center gap-2 rounded-md hover:bg-muted"><button type="button" className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => openSavedProject(project)}><span className="block truncate text-sm font-medium">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{project.rootPath}{project.subfolder ? ` / ${project.subfolder}` : ''} · {project.files.length} 个文档</span></button><button type="button" className="px-2 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" title="从列表移除（不会删除文件）" onClick={() => removeSavedProject(project.id)}>移除</button></div>)}</div></section>}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">输出设置</h2>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">书名<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="例如：秦末起义与汉王朝的建立" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block text-xs text-muted-foreground">子目录（可选）<input value={subfolder} onChange={(event) => setSubfolder(event.target.value)} placeholder="例如 docs" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block text-xs text-muted-foreground">拆分方式<select value={splitMode} onChange={(event) => setSplitMode(event.target.value as SplitMode)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"><option value="chapter">每章一个文件</option><option value="section">每节一个文件</option><option value="single">合并为单个文件</option></select></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={organizeByPart} disabled={splitMode === 'single'} onChange={(event) => setOrganizeByPart(event.target.checked)} />按“篇”创建文件夹</label>
            <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => setShowTemplate((value) => !value)}>{showTemplate ? '收起章节模板' : '编辑章节模板'}</button>
            {showTemplate && <><textarea value={template} onChange={(event) => setTemplate(event.target.value)} className="h-36 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs" /><p className="text-xs text-muted-foreground">变量：{'{{title}}'}、{'{{headings}}'}、{'{{placeholder}}'}</p></>}
            <Button variant="outline" className="w-full justify-start" onClick={chooseFolder}><FolderOpen className="mr-2 h-4 w-4" />{target ? target.path : '选择普通输出目录'}</Button>
            <Button variant={outputIsGitRepository ? 'secondary' : 'outline'} className="w-full justify-start" onClick={chooseGitOutput}><GitBranch className="mr-2 h-4 w-4" />{outputIsGitRepository ? '已指定 Git 仓库' : '指定 Git 仓库作为输出目录'}</Button>
            {target && outputIsGitRepository === true && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700">文章将直接生成到该仓库的“{subfolder.trim() || '根目录'}”目录中。</div>}
            {target && outputIsGitRepository === false && <Button className="w-full" disabled={gitLoading} onClick={initializeGit}><GitBranch className="mr-2 h-4 w-4" />初始化当前目录为 Git 仓库</Button>}
            {target && <Button variant="outline" className="w-full" onClick={() => loadExistingDocuments()}><BookOpen className="mr-2 h-4 w-4" />加载已有文档并保存为项目</Button>}
            {target && <Button variant="secondary" className="w-full" disabled={checking} onClick={checkExisting}>{checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}检查文件冲突</Button>}
            {conflicts.length > 0 && <div className="max-h-24 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">发现 {conflicts.length} 个同名文件：{conflicts.slice(0, 3).join('、')}{conflicts.length > 3 ? '…' : ''}</div>}
            {target && !checking && conflicts.length === 0 && <p className="text-xs text-muted-foreground">生成前会再次检查；已有文件不会被覆盖。</p>}
          </div>
        </section>
        <section className="min-h-[230px] flex-1 overflow-auto rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">目录预览</h2>{nodes.length > 0 && <Check className="h-4 w-4 text-emerald-500" />}</div>
          {nodes.length ? <OutlineTree nodes={nodes} /> : <p className="text-sm text-muted-foreground">输入目录后在这里预览层级。</p>}
        </section>
        <Button size="lg" disabled={!target || documents.length === 0 || creating} onClick={generate}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}生成 {documents.length || 0} 个章节文档</Button>
      </div>
    </div> : <div className={`grid min-h-0 flex-1 overflow-hidden ${aiOpen || reviewOpen || imageOpen || gitOpen ? 'grid-cols-[280px_minmax(0,1fr)_360px]' : 'grid-cols-[280px_minmax(0,1fr)]'}`}>
      <aside className="flex min-h-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between"><h2 className="truncate text-sm font-semibold">{activeProject?.name || projectTitle || '章节文档'}</h2><span className="text-xs text-muted-foreground">{managedFiles.length}</span></div>{activeProject && <div className="mb-1 text-xs text-emerald-600">● 已保存项目</div>}{target ? <><button type="button" className="w-full truncate text-left text-xs text-muted-foreground hover:text-foreground" title={target.path} onClick={() => loadExistingDocuments()}>{target.path}</button>{!activeProject && managedFiles.length > 0 && <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => rememberProject(target, managedFiles)}>保存为项目</Button>}</> : <Button size="sm" variant="outline" className="w-full" onClick={chooseFolder}>选择目录</Button>}</div>
        <div className="min-h-0 flex-1 overflow-auto p-2">{managedFiles.length ? managedFiles.map((path) => <button type="button" key={path} onClick={() => openDocument(path)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${activeFile === path ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><FileText className="h-4 w-4 shrink-0" /><span className="truncate" title={path}>{path.split('/').pop()}</span>{activeFile === path && dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" />}</button>) : recentProjects.length ? <div><div className="px-2 py-2 text-xs font-medium text-muted-foreground">历史项目</div>{recentProjects.map((project) => <button type="button" key={project.id} className="mb-1 w-full rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => openSavedProject(project)}><span className="block truncate text-sm font-medium">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{project.files.length} 个文档 · {new Date(project.updatedAt).toLocaleDateString()}</span></button>)}</div> : <div className="p-3 text-sm text-muted-foreground">生成文档或选择目录后，点击“加载已有文档”。</div>}</div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-border px-4"><div className="min-w-0"><span className="block truncate text-sm font-medium">{activeFile || '未选择文档'}</span></div><div className="flex items-center gap-2"><Button size="sm" variant={gitOpen ? 'default' : 'ghost'} disabled={!target} onClick={() => { toggleGit(); setReviewOpen(false); setImageOpen(false); }}> <GitBranch className="mr-2 h-4 w-4" />Git</Button><Button size="sm" variant={aiOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setAiOpen((value) => !value); setReviewOpen(false); setImageOpen(false); setGitOpen(false); }}><Sparkles className="mr-2 h-4 w-4" />助写</Button><Button size="sm" variant={reviewOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setReviewOpen((value) => !value); setAiOpen(false); setImageOpen(false); setGitOpen(false); setAiResult(''); setAiError(''); }}><Check className="mr-2 h-4 w-4" />审校</Button><Button size="sm" variant={imageOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setImageOpen((value) => !value); setAiOpen(false); setReviewOpen(false); setGitOpen(false); setImageError(''); }}><Sparkles className="mr-2 h-4 w-4" />插图</Button><Button size="sm" variant={editorMode === 'edit' ? 'secondary' : 'ghost'} onClick={() => setEditorMode('edit')}>编辑</Button><Button size="sm" variant={editorMode === 'preview' ? 'secondary' : 'ghost'} onClick={() => setEditorMode('preview')}>预览</Button><Button size="sm" disabled={!dirty || saving || !activeFile} onClick={saveDocument}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}保存</Button></div></div>
        <div className="min-h-0 flex-1 overflow-auto">{documentLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : !activeFile ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个文档</div> : editorMode === 'edit' ? <textarea value={documentContent} onChange={(event) => setDocumentContent(event.target.value)} spellCheck={false} className="h-full min-h-[500px] w-full resize-none border-0 bg-background p-6 font-mono text-sm leading-7 outline-none" /> : <article className="prose prose-sm mx-auto max-w-4xl p-8 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{documentContent}</ReactMarkdown></article>}</div>
        {activeFile && <div className="flex h-8 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground"><span>{dirty ? '有未保存的修改' : '所有修改已保存'}</span><span>{documentContent.length} 字符</span></div>}
      </main>
      {aiOpen && <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />AI 章节助写</div><p className="mt-1 text-xs text-muted-foreground">当前模型：{aiApi.model || '未配置'}</p></div>
        <div className="space-y-3 border-b border-border p-4">
          <label className="block text-xs text-muted-foreground">写作任务<select value={aiMode} onChange={(event) => setAiMode(event.target.value as typeof aiMode)} disabled={aiLoading} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"><option value="generate">生成本章正文</option><option value="continue">续写本章</option><option value="polish">润色全文</option></select></label>
          <label className="block text-xs text-muted-foreground">补充要求<textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} disabled={aiLoading} placeholder="例如：面向初学者，约 2000 字，多用案例说明" className="mt-1 h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm text-foreground" /></label>
          {!aiApi.apiKey?.trim() && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">尚未配置 API Key，请先前往应用设置配置 AI。</div>}
          {aiLoading ? <Button variant="outline" className="w-full" onClick={stopAi}>停止生成</Button> : <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={!aiApi.apiKey?.trim()} onClick={() => runAi(false)}><Sparkles className="mr-1 h-4 w-4" />生成预览</Button><Button disabled={!aiApi.apiKey?.trim()} onClick={() => runAi(true)}>生成并写入</Button></div>}
          {aiError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{aiError}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{aiResult ? <article className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown>{aiLoading && <span className="inline-block h-4 w-1 animate-pulse bg-primary" />}</article> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">选择任务并填写要求，<br />AI 结果将在这里预览。</div>}</div>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3"><Button variant="outline" disabled={!aiResult || aiLoading} onClick={() => applyAiResult('append')}>追加到文档</Button><Button disabled={!aiResult || aiLoading} onClick={() => applyAiResult('replace')}>替换文档</Button></div>
      </aside>}
      {reviewOpen && <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-primary" />第二模型审校报告</div><p className="mt-1 text-xs text-muted-foreground">指出错误、存疑内容和可扩写位置，不改动原文。</p></div>
        <div className="space-y-3 border-b border-border p-4">
          <label className="block text-xs text-muted-foreground">MiniMax 平台<select value={reviewBaseUrl} onChange={(event) => setReviewBaseUrl(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="https://api.minimaxi.com/v1">国内站 · api.minimaxi.com</option><option value="https://api.minimax.io/v1">全球站 · api.minimax.io</option></select></label>
          <label className="block text-xs text-muted-foreground">模型<input value={reviewModel} onChange={(event) => setReviewModel(event.target.value)} placeholder="MiniMax-M3" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
          <label className="block text-xs text-muted-foreground">API Key<input type="password" value={reviewApiKey} onChange={(event) => setReviewApiKey(event.target.value)} autoComplete="off" placeholder="粘贴完整 API Key" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
          <div className="grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" disabled={!isValidApiKey(reviewApiKey)} onClick={() => saveApiKey('review', reviewApiKey)}><Save className="mr-2 h-4 w-4" />加密保存</Button><Button type="button" size="sm" variant="ghost" onClick={() => clearApiKey('review')}>清除 Key</Button></div>
          <label className="block text-xs text-muted-foreground">审校要求<textarea value={reviewInstruction} onChange={(event) => setReviewInstruction(event.target.value)} className="mt-1 h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /></label>
          {aiLoading ? <Button variant="outline" className="w-full" onClick={stopAi}>停止审校</Button> : <Button className="w-full" disabled={!isValidApiKey(reviewApiKey) || !documentContent.trim()} onClick={runReview}><Check className="mr-2 h-4 w-4" />分析错误与扩写空间</Button>}
          {aiError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{aiError}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{aiResult ? <article className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown></article> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">AI 将列出明确错误、待核实内容、<br />扩写方向和修改优先级。</div>}</div>
        <div className="border-t border-border p-3"><Button className="w-full" variant="outline" disabled={!aiResult || aiLoading} onClick={() => { window.electronAPI.copyText(aiResult); notice.success({ message: '审校报告已复制', placement: 'bottomRight' }); }}>复制审校报告</Button></div>
      </aside>}
      {imageOpen && <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />MiniMax 章节插图</div><p className="mt-1 text-xs text-muted-foreground">先生成预览，确认后保存到 assets/images 并插入文章。</p></div>
        <div className="space-y-3 border-b border-border p-4">
          <label className="block text-xs text-muted-foreground">MiniMax API Key<input type="password" value={minimaxApiKey} onChange={(event) => setMinimaxApiKey(event.target.value)} autoComplete="off" placeholder="粘贴完整 API Key" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
          <div className="grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" disabled={!isValidApiKey(minimaxApiKey)} onClick={() => saveApiKey('minimax', minimaxApiKey)}><Save className="mr-2 h-4 w-4" />加密保存</Button><Button type="button" size="sm" variant="ghost" onClick={() => clearApiKey('minimax')}>清除 Key</Button></div>
          <label className="block text-xs text-muted-foreground">画幅<select value={imageAspectRatio} onChange={(event) => setImageAspectRatio(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="16:9">横版 16:9</option><option value="4:3">横版 4:3</option><option value="1:1">方形 1:1</option><option value="3:4">竖版 3:4</option><option value="9:16">竖版 9:16</option></select></label>
          <label className="block text-xs text-muted-foreground">插图描述<textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} maxLength={1000} placeholder="例如：秦代宫殿俯瞰图，历史绘本质感，暖灰与朱红配色，人物服饰符合时代特征" className="mt-1 h-28 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /></label>
          <Button className="w-full" disabled={imageLoading || !isValidApiKey(minimaxApiKey) || !imagePrompt.trim()} onClick={generateIllustration}>{imageLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成插图预览</Button>
          {imageError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{imageError}</div>}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">{imageDataUrl ? <img src={imageDataUrl} alt="MiniMax 生成的章节插图预览" className="max-h-full w-full rounded-lg object-contain shadow-sm" /> : <div className="text-center text-xs text-muted-foreground">MiniMax image-01 的生成结果<br />将在这里预览。</div>}</div>
        <div className="border-t border-border p-3"><Button className="w-full" disabled={!imageDataUrl || imageLoading} onClick={saveAndInsertIllustration}>保存图片并插入文档末尾</Button></div>
      </aside>}
      {gitOpen && <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><GitBranch className="h-4 w-4 text-primary" />保存到 Git 仓库</div><label className="flex items-center gap-2 text-xs text-muted-foreground">网站主题色<input type="color" value={pagesAccentColor} onChange={(event) => setPagesAccentColor(event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" /></label></div><p className="mt-1 text-xs text-muted-foreground">只提交当前文章项目，不包含仓库中的其他改动。</p></div>
        <div className="max-h-[58vh] space-y-3 overflow-auto border-b border-border p-4"><label className="block text-xs text-muted-foreground">提交说明<input value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /></label>{gitRepository === false && <Button className="w-full" disabled={gitLoading} onClick={initializeGit}><GitBranch className="mr-2 h-4 w-4" />初始化为 Git 仓库</Button>}<div className="flex gap-2"><Button variant="outline" className="flex-1" disabled={gitLoading} onClick={refreshGit}>{gitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}刷新状态</Button><Button className="flex-1" disabled={gitLoading || gitRepository !== true || !gitChanges.length || !gitMessage.trim()} onClick={commitToGit}>本地提交 {gitChanges.length}</Button></div><div className="border-t border-border pt-3"><div className="mb-2 text-xs font-medium">推送到新的远程仓库</div><input value={gitRemoteUrl} onChange={(event) => setGitRemoteUrl(event.target.value)} placeholder="https://github.com/user/repo.git 或 git@..." className="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /><div className="grid grid-cols-2 gap-2"><input value={gitRemoteName} onChange={(event) => setGitRemoteName(event.target.value)} placeholder="origin" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /><input value={gitBranch} onChange={(event) => setGitBranch(event.target.value)} placeholder="main" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /></div><Button className="mt-2 w-full" disabled={gitLoading || !gitRemoteUrl.trim() || !gitRemoteName.trim() || !gitBranch.trim()} onClick={publishToRemote}>提交并推送到远程仓库</Button><p className="mt-2 text-xs text-muted-foreground">HTTPS 凭据由 Git Credential Manager 管理；SSH 地址使用系统 SSH Key。</p></div><div className="border-t border-border pt-3"><button type="button" className="flex w-full items-center justify-between text-left text-xs font-medium" onClick={() => setPagesOpen((value) => !value)}><span>GitHub Pages 配置</span><span>{pagesOpen ? '收起' : '展开'}</span></button>{pagesOpen && <div className="mt-3 space-y-2"><input value={pagesTitle} onChange={(event) => setPagesTitle(event.target.value)} placeholder="站点标题" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><textarea value={pagesDescription} onChange={(event) => setPagesDescription(event.target.value)} placeholder="站点描述（用于首页与 SEO）" className="h-16 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /><div className="grid grid-cols-2 gap-2"><input value={pagesAuthor} onChange={(event) => setPagesAuthor(event.target.value)} placeholder="作者" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><input value={pagesLanguage} onChange={(event) => setPagesLanguage(event.target.value)} placeholder="zh-CN" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div><input value={pagesRepositoryName} onChange={(event) => setPagesRepositoryName(event.target.value)} placeholder="仓库名（项目站点需要，例如 my-book）" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><input value={pagesCustomDomain} onChange={(event) => setPagesCustomDomain(event.target.value)} placeholder="自定义域名（可选，例如 book.example.com）" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><Button className="w-full" disabled={gitLoading || !managedFiles.length} onClick={configureGitHubPages}>生成 GitHub Pages 配置</Button><p className="text-xs text-muted-foreground">主题：Minima；包含 SEO、RSS、404、章节首页和自动部署 workflow。</p>{pagesCustomDomain.trim() && <p className="text-xs text-amber-700">自定义域名仍需在 GitHub 仓库 Settings → Pages 中配置并完成 DNS 验证。</p>}</div>}</div>{gitError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{gitError}</div>}</div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{gitChanges.length ? gitChanges.map((change) => <div key={change.path} className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted"><span className="w-6 shrink-0 font-mono text-primary">{change.status.trim() || 'M'}</span><span className="truncate" title={change.path}>{change.path}</span></div>) : !gitLoading && !gitError ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">文章目录没有待提交的改动</div> : null}</div>
      </aside>}
    </div>}
  </div>;
};
