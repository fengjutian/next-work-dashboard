import React, { useEffect, useMemo, useRef, useState } from 'react';
import { notification } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Check, FileText, FolderOpen, GitBranch, Loader2, Save, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { chapterStateAfterSave, createChapterDocuments, createReadme, parseOutline, sortChapterPaths, type ChapterWorkflowState, type OutlineNode, type SplitMode } from './outline';

const DEFAULT_TEMPLATE = `# {{title}}

{{placeholder}}

{{headings}}`;

const RECENT_PROJECTS_KEY = 'outline-scaffolder.recent-projects.v1';
const normalizeApiKey = (value: string) => value.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
const isValidApiKey = (value: string) => /^[\x21-\x7E]+$/.test(normalizeApiKey(value));
const countArticleWords = (markdown: string) => {
  const text = markdown
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~`>|]/g, ' ');
  const cjkCount = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
  const latinAndNumberCount = (text.match(/[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/g) ?? []).length;
  return cjkCount + latinAndNumberCount;
};
const appendSourceReferences = (markdown: string, sources: string) => {
  if (!sources.trim() || /^##\s+(史料与参考资料|参考资料|参考文献)\s*$/m.test(markdown)) return markdown.trimEnd();
  const references = new Map<string, string>();
  for (const match of sources.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    const title = match[1].trim();
    const url = match[2].trim();
    if (title && url && !references.has(url)) references.set(url, title);
  }
  if (!references.size) return markdown.trimEnd();
  const items = [...references].map(([url, title], index) => `${index + 1}. [${title}](${url})${sources.includes('搜索摘要（仅作线索') ? '（检索线索，引用前需核对原文）' : ''}`).join('\n');
  return `${markdown.trimEnd()}\n\n## 史料与参考资料\n\n${items}`;
};
const normalizeForComparison = (value: string) => value.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/[\s*_~`>，。！？；：、“”‘’（）()]+/g, '').replaceAll('[', '').replaceAll(']', '').toLowerCase();
const removeRepeatedContinuation = (existing: string, generated: string) => {
  const existingNormalized = normalizeForComparison(existing);
  const blocks = generated.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/i, '').trim().split(/\n\s*\n/);
  const uniqueBlocks = blocks.filter((block) => {
    const normalized = normalizeForComparison(block);
    if (!normalized) return false;
    if (/^##?史料与参考资料/.test(block.trim())) return false;
    return normalized.length < 12 || !existingNormalized.includes(normalized);
  });
  return uniqueBlocks.join('\n\n').trim();
};
const insertBeforeSourceReferences = (existing: string, addition: string) => {
  const marker = existing.search(/^##\s+(史料与参考资料|参考资料|参考文献)\s*$/m);
  if (marker < 0) return `${existing.trimEnd()}\n\n${addition.trim()}\n`;
  const body = existing.slice(0, marker).trimEnd();
  const references = existing.slice(marker).trimStart();
  return `${body}\n\n${addition.trim()}\n\n${references.trimEnd()}\n`;
};
const parseReviewSuggestions = (report: string): ReviewSuggestion[] => [...report.matchAll(/-\s*\*\*位置\*\*[：:]\s*([^\n]+)([\s\S]*?)(?=\n-\s*\*\*位置\*\*|\n##\s|$)/g)].map((match, index) => {
  const body = match[2];
  const field = (name: string) => body.match(new RegExp(`\\*\\*${name}\\*\\*[：:]\\s*([^\\n]+)`))?.[1]?.trim() ?? '';
  return { id: `${Date.now()}-${index}`, section: field('类型') || '审校建议', position: match[1].trim(), issue: field('问题') || field('为什么值得扩写'), suggestion: field('建议') || field('扩写方向'), decision: 'pending' as const };
});

interface SavedProject {
  id: string;
  name: string;
  rootPath: string;
  subfolder: string;
  source: string;
  requirement?: string;
  chapterBriefs?: Record<string, ChapterWritingBrief>;
  chapterStatuses?: Record<string, ChapterGenerationStatus>;
  knowledgeEntries?: KnowledgeEntry[];
  evidenceRecords?: EvidenceRecord[];
  qualityReports?: Record<string, ChapterQualityReport>;
  deploymentStatus?: DeploymentStatus;
  splitMode: SplitMode;
  organizeByPart: boolean;
  template: string;
  files: string[];
  updatedAt: number;
  git?: { remoteUrl: string; remoteName: string; branch: string };
  pages?: { title: string; description: string; author: string; language: string; repositoryName: string; customDomain: string; accentColor?: string };
}

interface ResearchSourceCard {
  id: string;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  source: string;
  selected: boolean;
}

interface ChapterWritingBrief {
  goal: string;
  targetWords: number;
  keyQuestions: string;
  requiredSources: string;
  avoidTopics: string;
}

interface KnowledgeEntry { id: string; kind: 'person' | 'event' | 'place' | 'term' | 'date'; name: string; canonical: string; aliases: string; notes: string }
interface EvidenceRecord { id: string; title: string; url: string; source: string; chapter: string; status: 'clue' | 'verified' | 'disputed'; notes: string; anchor?: { quote: string }; createdAt: number }
interface ChapterQualityReport { score: number; blockers: string[]; warnings: string[]; wordCount: number; checkedAt: number }
interface ReviewSuggestion { id: string; section: string; position: string; issue: string; suggestion: string; decision: 'pending' | 'accepted' | 'rejected' }
interface ReviewPatch { id: string; suggestionId: string; original: string; replacement: string; state: 'ready' | 'applied' | 'conflict' }
interface GateFixTarget { path: string; blockers: string[] }
interface DeploymentStatus { state: 'unconfigured' | 'configured' | 'publishing' | 'published' | 'failed'; url?: string; message?: string; updatedAt: number }

type ChapterGenerationState = ChapterWorkflowState;
interface ChapterGenerationStatus { state: ChapterGenerationState; error?: string; updatedAt: number }

const CHAPTER_STATUS_META: Record<ChapterGenerationState, { label: string; dot: string }> = {
  pending: { label: '待写作', dot: 'bg-slate-400' },
  generating: { label: '生成中', dot: 'bg-primary animate-pulse' },
  draft: { label: '草稿待确认', dot: 'bg-sky-500' },
  review: { label: '待审校', dot: 'bg-amber-500' },
  revising: { label: '修改待确认', dot: 'bg-orange-500' },
  quality: { label: '待质量检查', dot: 'bg-violet-500' },
  complete: { label: '已完成', dot: 'bg-emerald-500' },
  error: { label: '生成失败', dot: 'bg-destructive' },
};

const EMPTY_CHAPTER_BRIEF: ChapterWritingBrief = { goal: '', targetWords: 2500, keyQuestions: '', requiredSources: '', avoidTopics: '' };
const attachChapterBrief = (content: string, brief?: ChapterWritingBrief) => {
  if (!brief || (!brief.goal.trim() && !brief.keyQuestions.trim() && !brief.requiredSources.trim() && !brief.avoidTopics.trim())) return content;
  const clean = (value: string) => value.trim().replace(/-->/g, '→');
  const block = `<!-- chapter-writing-brief\n目标字数：${Math.max(100, brief.targetWords || 2500)}\n写作目标：${clean(brief.goal)}\n核心问题：${clean(brief.keyQuestions)}\n必用史料：${clean(brief.requiredSources)}\n避免重复：${clean(brief.avoidTopics)}\n-->`;
  const titleEnd = content.match(/^#\s+.*$/m);
  if (!titleEnd?.index && titleEnd?.index !== 0) return `${block}\n\n${content}`;
  const position = titleEnd.index + titleEnd[0].length;
  return `${content.slice(0, position)}\n\n${block}${content.slice(position)}`;
};

function loadSavedProjects(): SavedProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, 20) : [];
  } catch { return []; }
}

const serializeOutline = (nodes: OutlineNode[]): string => nodes.map((node) => `${'#'.repeat(Math.min(6, Math.max(1, node.level)))} ${node.title}${node.children.length ? `\n${serializeOutline(node.children)}` : ''}`).join('\n');

function EditableOutlineTree({ nodes, onRename, onDelete, onMove }: { nodes: OutlineNode[]; onRename: (id: string, title: string) => void; onDelete: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void }) {
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  return <ul className="space-y-1">{nodes.map((node) => <li key={node.id}>
    <div className="group flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60"><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{editingId === node.id ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim()) { onRename(node.id, draft.trim()); setEditingId(''); } if (event.key === 'Escape') setEditingId(''); }} onBlur={() => { if (draft.trim()) onRename(node.id, draft.trim()); setEditingId(''); }} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm" /> : <span className="min-w-0 flex-1 truncate">{node.title}</span>}<button type="button" title="上移" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100" onClick={() => onMove(node.id, -1)}>↑</button><button type="button" title="下移" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100" onClick={() => onMove(node.id, 1)}>↓</button><button type="button" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100" onMouseDown={(event) => event.preventDefault()} onClick={() => { setEditingId(node.id); setDraft(node.title); }}>修改</button><button type="button" className="text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" onClick={() => onDelete(node.id)}>删除</button></div>
    {node.children.length > 0 && <div className="ml-5 border-l border-border pl-2"><EditableOutlineTree nodes={node.children} onRename={onRename} onDelete={onDelete} onMove={onMove} /></div>}
  </li>)}</ul>;
}

export const OutlineScaffolderPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [antdNotice, holder] = notification.useNotification();
  const notice = useMemo(() => {
    type NoticeConfig = Omit<Parameters<typeof antdNotice.open>[0], 'title' | 'message'> & { message: React.ReactNode };
    const modernize = ({ message, ...config }: NoticeConfig): Parameters<typeof antdNotice.open>[0] => ({ ...config, title: message });
    return {
      success: (config: NoticeConfig) => antdNotice.success(modernize(config)),
      warning: (config: NoticeConfig) => antdNotice.warning(modernize(config)),
      error: (config: NoticeConfig) => antdNotice.error(modernize(config)),
      info: (config: NoticeConfig) => antdNotice.info(modernize(config)),
    };
  }, [antdNotice]);
  const [source, setSource] = useState('');
  const [bookRequirement, setBookRequirement] = useState('');
  const [outlineGenerating, setOutlineGenerating] = useState(false);
  const [outlineError, setOutlineError] = useState('');
  const [outlineVersions, setOutlineVersions] = useState<Array<{ source: string; createdAt: number; label: string }>>([]);
  const [chapterBriefs, setChapterBriefs] = useState<Record<string, ChapterWritingBrief>>({});
  const [showChapterBriefs, setShowChapterBriefs] = useState(false);
  const [chapterStatuses, setChapterStatuses] = useState<Record<string, ChapterGenerationStatus>>({});
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceRecord[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [qualityReports, setQualityReports] = useState<Record<string, ChapterQualityReport>>({});
  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewSuggestion[]>([]);
  const [reviewPatches, setReviewPatches] = useState<ReviewPatch[]>([]);
  const [reviewPatchLoading, setReviewPatchLoading] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>({ state: 'unconfigured', updatedAt: 0 });
  const [deploymentChecking, setDeploymentChecking] = useState(false);
  const [pagesRunUrl, setPagesRunUrl] = useState('');
  const [publishGateIssues, setPublishGateIssues] = useState<string[]>([]);
  const [publishCanOverride, setPublishCanOverride] = useState(false);
  const [gateFixTargets, setGateFixTargets] = useState<GateFixTarget[]>([]);
  const gateFixTargetsRef = useRef<GateFixTarget[]>([]);
  const gateRepairActiveRef = useRef(false);
  const [managementTab, setManagementTab] = useState<'overview' | 'knowledge' | 'evidence' | 'quality' | 'publish'>('overview');
  const [auditLoading, setAuditLoading] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [manifestSyncState, setManifestSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [consistencyIssues, setConsistencyIssues] = useState<string[]>([]);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, current: '' });
  const batchStopRef = useRef(false);
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
  const [view, setView] = useState<'generator' | 'documents' | 'management'>('generator');
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
  const [aiMode, setAiMode] = useState<'generate' | 'continue' | 'polish' | 'revise'>('generate');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiSources, setAiSources] = useState('');
  const [researchPlans, setResearchPlans] = useState<Record<string, string>>({});
  const [researchPlanLoading, setResearchPlanLoading] = useState(false);
  const [sourceResearchLoading, setSourceResearchLoading] = useState(false);
  const [sourceResearchError, setSourceResearchError] = useState('');
  const [sourceResearchQueries, setSourceResearchQueries] = useState<string[]>([]);
  const [sourceResearchResults, setSourceResearchResults] = useState<ResearchSourceCard[]>([]);
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const nodes = useMemo(() => parseOutline(source), [source]);
  const baseDocuments = useMemo(() => createChapterDocuments(nodes, { folder: subfolder, splitMode, organizeByPart, projectTitle, template }), [nodes, organizeByPart, projectTitle, splitMode, subfolder, template]);
  const documents = useMemo(() => baseDocuments.map((document) => ({ ...document, content: attachChapterBrief(document.content, chapterBriefs[document.path]) })), [baseDocuments, chapterBriefs]);
  const files = useMemo(() => [...documents, createReadme(documents, projectTitle, subfolder)], [documents, projectTitle, subfolder]);
  const articleWordCount = useMemo(() => countArticleWords(documentContent), [documentContent]);
  const generatorStage = nodes.length ? (target ? 3 : 2) : bookRequirement.trim() ? 1 : 0;
  const outlineWarnings = useMemo(() => {
    const flat = (items: OutlineNode[]): OutlineNode[] => items.flatMap((item) => [item, ...flat(item.children)]);
    const all = flat(nodes);
    const counts = new Map<string, number>();
    all.forEach((item) => counts.set(item.title.trim().toLowerCase(), (counts.get(item.title.trim().toLowerCase()) ?? 0) + 1));
    const warnings: string[] = [...counts].filter(([, count]) => count > 1).map(([title, count]) => `目录“${title}”重复 ${count} 次`);
    if (nodes.some((item) => item.level > 1)) warnings.push('顶层目录不是一级标题，生成时可能无法正确按“篇”组织');
    if (nodes.length > 0 && documents.length === 0) warnings.push('当前目录无法识别出可生成的章节');
    if (documents.length > 80) warnings.push(`将生成 ${documents.length} 个文件，建议分批处理或减少拆分层级`);
    return warnings;
  }, [documents.length, nodes]);

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

  const generateOutlineFromRequirement = async () => {
    if (!bookRequirement.trim() || outlineGenerating) return;
    if (!aiApi.apiKey?.trim()) { setOutlineError('请先在应用设置中配置助写模型和 API Key。'); return; }
    setOutlineGenerating(true); setOutlineError('');
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是图书策划编辑。根据用户需求设计一份层级清晰、范围完整、章节之间不重复的中文目录。只输出 Markdown 标题：一级标题用于“篇”，二级标题用于“章”，三级标题用于“节”。每章应有明确任务并按时间、因果或主题逻辑推进。不要输出说明、正文、序言或代码围栏。建议 2—5 篇、每篇 3—8 章、每章 2—5 节；若篇幅较小可不分篇。' },
        { role: 'user', content: `暂定书名：${projectTitle}\n写作需求：\n${bookRequirement.trim()}\n\n请生成可直接用于文档拆分的目录。` },
      ];
      let result = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.45, maxTokens: 4_096, stream: false })) result += chunk.delta || '';
      const cleaned = result.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/i, '').trim();
      if (!parseOutline(cleaned).length) throw new Error('AI 没有生成有效目录，请补充目标读者、范围和预计篇幅后重试。');
      if (source.trim() && source.trim() !== cleaned) setOutlineVersions((current) => [{ source, createdAt: Date.now(), label: 'AI 生成前' }, ...current].slice(0, 10));
      setSource(cleaned); setConflicts([]);
      notice.success({ message: '目录初稿已生成', description: '请在目录树中修改或删除章节，确认后再生成文档。', placement: 'bottomRight' });
    } catch (error) { setOutlineError(error instanceof Error ? error.message : String(error)); }
    finally { setOutlineGenerating(false); }
  };

  const updateOutlineNodes = (transform: (nodes: OutlineNode[]) => OutlineNode[]) => setSource(serializeOutline(transform(nodes)));
  const renameOutlineNode = (id: string, title: string) => updateOutlineNodes((items) => {
    const visit = (list: OutlineNode[]): OutlineNode[] => list.map((item) => item.id === id ? { ...item, title } : { ...item, children: visit(item.children) });
    return visit(items);
  });
  const deleteOutlineNode = (id: string) => {
    const findNode = (items: OutlineNode[]): OutlineNode | undefined => { for (const item of items) { if (item.id === id) return item; const child = findNode(item.children); if (child) return child; } return undefined; };
    const targetNode = findNode(nodes);
    if (!targetNode || !window.confirm(`删除“${targetNode.title}”及其全部下级目录吗？`)) return;
    updateOutlineNodes((items) => { const remove = (list: OutlineNode[]): OutlineNode[] => list.filter((item) => item.id !== id).map((item) => ({ ...item, children: remove(item.children) })); return remove(items); });
  };
  const moveOutlineNode = (id: string, direction: -1 | 1) => updateOutlineNodes((items) => {
    const move = (list: OutlineNode[]): OutlineNode[] => {
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= list.length) return list;
        const next = [...list];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      }
      return list.map((item) => ({ ...item, children: move(item.children) }));
    };
    return move(items);
  });
  const saveOutlineVersion = (label = '手动快照') => {
    if (!source.trim()) return;
    setOutlineVersions((current) => [{ source, createdAt: Date.now(), label }, ...current.filter((item) => item.source !== source)].slice(0, 10));
    notice.success({ message: '目录版本已保存', placement: 'bottomRight' });
  };
  const updateChapterBrief = (path: string, patch: Partial<ChapterWritingBrief>) => setChapterBriefs((current) => ({ ...current, [path]: { ...EMPTY_CHAPTER_BRIEF, ...current[path], ...patch } }));
  const setChapterStatus = (path: string, state: ChapterGenerationState, error?: string) => setChapterStatuses((current) => ({ ...current, [path]: { state, error, updatedAt: Date.now() } }));
  const inspectChapterQuality = (path: string, content: string): ChapterQualityReport => {
    const words = countArticleWords(content);
    const brief = { ...EMPTY_CHAPTER_BRIEF, ...chapterBriefs[path] };
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (/<!--\s*在这里添加内容\s*-->/.test(content)) blockers.push('仍包含正文占位符');
    if (words < Math.max(300, Math.round(brief.targetWords * 0.7))) blockers.push(`正文仅 ${words} 字，未达到目标字数的 70%`);
    if (/<!--\s*待核实[：:]/.test(content)) blockers.push('仍有待核实事实');
    if (brief.requiredSources.trim()) {
      const required = brief.requiredSources.split(/[、，,;；\n]+/).map((item) => item.trim()).filter(Boolean);
      const missing = required.filter((item) => !content.includes(item));
      if (missing.length) blockers.push(`缺少必用史料：${missing.slice(0, 3).join('、')}`);
    }
    const evidence = evidenceRecords.filter((item) => item.chapter === path);
    if (!/^##\s+(史料与参考资料|参考资料|参考文献)\s*$/m.test(content)) warnings.push('没有文末参考资料区');
    if (!evidence.some((item) => item.status === 'verified')) warnings.push('没有已核实的证据记录');
    else if (!evidence.some((item) => item.status === 'verified' && item.anchor?.quote && content.includes(item.anchor.quote))) warnings.push('已核实史料尚未绑定到正文观点');
    const unsupportedStrongClaims = content.match(/(?:彻底|唯一|必然|完全|从根本上|极度|绝对|致命)(?:[^。！？\n]{0,28})(?:。|！|？)/g) ?? [];
    if (unsupportedStrongClaims.length >= 2) warnings.push(`存在 ${unsupportedStrongClaims.length} 处高强度结论，请核对证据并改写绝对化表述`);
    const genericHistoricalPhrases = content.match(/(?:宏伟蓝图之下|历史长河中|时代洪流|思想的火种|致命暗伤|深深裂痕|历史舞台)/g) ?? [];
    if (genericHistoricalPhrases.length) warnings.push('存在模板化历史叙述，建议改为具体制度、材料、行动或争议分析');
    const highRiskClaims = [
      ...(content.match(/(?:公元前|公元|前)\s*\d+年|\d+(?:\.\d+)?(?:万|亿|余)?(?:人|户|郡|县|年|里|件|次)/g) ?? []),
      ...(content.match(/[“"][^”"\n]{4,80}[”"]/g) ?? []),
      ...(content.match(/(?:百姓|民众|士人|知识分子|六国人|天下人)[^。！？\n]{0,32}(?:认为|反对|支持|不满|恐惧|认同|离心)/g) ?? []),
      ...(content.match(/[^。！？\n]{4,40}(?:因此|由此|从而|导致|造成|成为了?)[^。！？\n]{4,40}/g) ?? []),
    ];
    if (highRiskClaims.length && !evidence.some((item) => item.status === 'verified')) warnings.push(`主张审计发现 ${highRiskClaims.length} 处日期、数字、引语、群体心理或强因果表述，但本章没有已核实证据`);
    if ((content.match(/^##\s+/gm) ?? []).length === 0) warnings.push('缺少二级标题，长文可读性较弱');
    const score = Math.max(0, 100 - blockers.length * 25 - warnings.length * 8);
    return { score, blockers, warnings, wordCount: words, checkedAt: Date.now() };
  };

  const runBookAudit = async () => {
    if (!target || !managedFiles.length || auditLoading) return;
    setAuditLoading(true);
    try {
      const reports: Record<string, ChapterQualityReport> = {};
      const issues: string[] = [];
      const paragraphOwners = new Map<string, string>();
      for (const path of managedFiles) {
        if (!path.toLowerCase().endsWith('.md') || /README\.md$/i.test(path)) continue;
        const read = await window.electronAPI.workspace.readTextFile(target.path, path);
        if (!read.success || !read.data) { issues.push(`${path}：无法读取`); continue; }
        const content = read.data.content;
        reports[path] = inspectChapterQuality(path, content);
        content.split(/\n\s*\n/).forEach((paragraph) => {
          const normalized = normalizeForComparison(paragraph);
          if (normalized.length < 60) return;
          const owner = paragraphOwners.get(normalized);
          if (owner && owner !== path) issues.push(`${path} 与 ${owner} 存在重复段落`); else paragraphOwners.set(normalized, path);
        });
        knowledgeEntries.forEach((entry) => {
          const aliases = entry.aliases.split(/[、，,;；\n]+/).map((item) => item.trim()).filter(Boolean);
          const usedAliases = aliases.filter((alias) => content.includes(alias));
          if (usedAliases.length && !content.includes(entry.canonical || entry.name)) issues.push(`${path} 使用“${usedAliases.join('、')}”，建议统一为“${entry.canonical || entry.name}”`);
        });
      }
      setQualityReports(reports); setConsistencyIssues([...new Set(issues)].slice(0, 100));
      notice.success({ message: '全书检查完成', description: `检查 ${Object.keys(reports).length} 章，发现 ${new Set(issues).size} 项一致性提示。`, placement: 'bottomRight' });
    } finally { setAuditLoading(false); }
  };

  const extractBookKnowledge = async () => {
    if (!target || !managedFiles.length || knowledgeLoading) return;
    if (!aiApi.apiKey?.trim()) { notice.warning({ message: '请先配置助写模型', placement: 'bottomRight' }); return; }
    setKnowledgeLoading(true);
    try {
      const excerpts: string[] = [];
      let total = 0;
      for (const path of managedFiles.filter((item) => !/README\.md$/i.test(item))) {
        if (total >= 60_000) break;
        const read = await window.electronAPI.workspace.readTextFile(target.path, path);
        if (!read.success || !read.data) continue;
        const excerpt = read.data.content.slice(0, Math.min(6_000, 60_000 - total));
        excerpts.push(`## ${path}\n${excerpt}`); total += excerpt.length;
      }
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是长篇中文作品的知识编辑。只从用户提供的正文中提取反复出现、需要全书统一的人物、事件、地点、术语和关键年代。不得补充正文中没有的信息。输出严格 JSON 数组，每项字段为 kind（person/event/place/term/date）、name、canonical、aliases、notes。canonical 是建议的统一写法；aliases 用顿号分隔；notes 只写正文能够支持的简短事实或使用规则。最多 80 项，不输出代码围栏。' },
        { role: 'user', content: excerpts.join('\n\n') },
      ];
      let raw = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.15, maxTokens: 6_000, stream: false })) raw += chunk.delta || '';
      const json = raw.match(/\[[\s\S]*\]/)?.[0];
      if (!json) throw new Error('模型没有返回可解析的知识条目');
      const parsed = JSON.parse(json) as Array<Partial<KnowledgeEntry>>;
      const allowed = new Set<KnowledgeEntry['kind']>(['person', 'event', 'place', 'term', 'date']);
      const extracted: KnowledgeEntry[] = parsed.filter((item) => item.name && allowed.has(item.kind as KnowledgeEntry['kind'])).map((item, index) => ({ id: `auto-${Date.now()}-${index}`, kind: item.kind as KnowledgeEntry['kind'], name: String(item.name).trim(), canonical: String(item.canonical || item.name).trim(), aliases: String(item.aliases || '').trim(), notes: String(item.notes || '').trim() }));
      if (!extracted.length) throw new Error('没有提取到需要统一的知识条目');
      if (!window.confirm(`AI 提取了 ${extracted.length} 条知识。确认后将合并到知识库，仍可逐条编辑或删除。`)) return;
      setKnowledgeEntries((current) => {
        const keys = new Set(current.map((item) => `${item.kind}:${item.name}`));
        return [...current, ...extracted.filter((item) => !keys.has(`${item.kind}:${item.name}`))];
      });
      notice.success({ message: `已合并 ${extracted.length} 条知识候选`, placement: 'bottomRight' });
    } catch (error) {
      notice.error({ message: '知识抽取失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setKnowledgeLoading(false); }
  };

  const passQualityGate = (path: string) => {
    setAiOpen(false); setReviewOpen(false); setImageOpen(false); setGitOpen(false);
    if (path === activeFile && dirty) {
      notice.warning({ key: 'chapter-quality-gate', message: '请先保存当前修改', description: '质量检查只针对已经保存的正文。', placement: 'bottomRight' });
      return;
    }
    const report = path === activeFile ? inspectChapterQuality(path, documentContent) : qualityReports[path];
    if (!report) { notice.warning({ message: '请先运行全书检查', placement: 'bottomRight' }); return; }
    setQualityReports((current) => ({ ...current, [path]: report }));
    if (report.blockers.length) return;
    setChapterStatus(path, 'complete');
    notice.success({ key: 'chapter-quality-gate', message: '章节已通过质量检查', placement: 'bottomRight' });
  };

  const locateFirstQualityIssue = () => {
    const match = documentContent.match(/<!--\s*(?:待核实[：:]|在这里添加内容)[\s\S]*?-->/);
    const start = match?.index;
    if (!match || start === undefined) return;
    setEditorMode('edit');
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(start, start + match[0].length);
      editorRef.current?.scrollIntoView({ block: 'center' });
    });
  };

  const confirmCurrentDraft = () => {
    if (!activeFile) return;
    if (dirty) { notice.warning({ message: '请先保存当前草稿', placement: 'bottomRight' }); return; }
    setChapterStatus(activeFile, 'review');
    setAiOpen(false); setReviewOpen(true); setImageOpen(false); setGitOpen(false);
    setAiResult(''); setAiError(''); setReviewSuggestions([]); setReviewPatches([]);
  };

  const enterQualityCheck = () => {
    if (!activeFile) return;
    if (dirty) { notice.warning({ message: '请先保存审校后的修改', placement: 'bottomRight' }); return; }
    setChapterStatus(activeFile, 'quality');
  };

  const bindEvidenceToSelection = () => {
    if (!activeFile || !selectedEvidenceId || !editorRef.current) return;
    const editor = editorRef.current;
    const quote = documentContent.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (!quote) { notice.warning({ message: '请先在正文编辑器中选择需要证据支撑的文字', placement: 'bottomRight' }); return; }
    setEvidenceRecords((current) => current.map((item) => item.id === selectedEvidenceId ? { ...item, chapter: activeFile, anchor: { quote } } : item));
    notice.success({ message: '证据已绑定到所选文字', description: quote.slice(0, 80), placement: 'bottomRight' });
  };

  const refreshPagesDeployment = async () => {
    if (!gitRemoteUrl.trim() || deploymentChecking) return;
    setDeploymentChecking(true);
    try {
      const result = await window.electronAPI.outlineGithub.pagesStatus(gitRemoteUrl.trim());
      if (!result.success || !result.data) throw new Error(result.error || '没有构建记录');
      const run = result.data;
      setPagesRunUrl(run.url ?? '');
      if (run.state === 'completed' && run.conclusion === 'success') setDeploymentStatus((current) => ({ ...current, state: 'published', message: `GitHub Pages 构建成功${run.branch ? ` · ${run.branch}` : ''}`, updatedAt: run.updatedAt ? Date.parse(run.updatedAt) : Date.now() }));
      else if (run.state === 'completed') setDeploymentStatus((current) => ({ ...current, state: 'failed', message: `GitHub Pages 构建${run.conclusion || '失败'}`, updatedAt: run.updatedAt ? Date.parse(run.updatedAt) : Date.now() }));
      else setDeploymentStatus((current) => ({ ...current, state: 'publishing', message: `GitHub Actions：${run.state}`, updatedAt: run.updatedAt ? Date.parse(run.updatedAt) : Date.now() }));
    } catch (error) {
      notice.error({ message: '无法读取 Pages 构建状态', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setDeploymentChecking(false); }
  };

  const runBatchGeneration = async () => {
    if (!target || batchGenerating) return;
    if (!aiApi.apiKey?.trim()) { notice.error({ message: '请先配置助写模型', placement: 'bottomRight' }); return; }
    const candidates = managedFiles.filter((path) => ['pending', 'error'].includes(chapterStatuses[path]?.state ?? 'pending'));
    if (!candidates.length) { notice.info({ message: '没有待生成或失败的章节', placement: 'bottomRight' }); return; }
    if (!window.confirm(`将串行生成 ${candidates.length} 个章节。已有正文不会被覆盖，是否继续？`)) return;
    batchStopRef.current = false; setBatchGenerating(true); setBatchProgress({ completed: 0, total: candidates.length, current: '' });
    const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
    let completed = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (batchStopRef.current) break;
      const path = candidates[index];
      const chapterName = path.split('/').pop()?.replace(/\.md$/i, '').replace(/^\d+-/, '') ?? path;
      setBatchProgress({ completed, total: candidates.length, current: chapterName }); setChapterStatus(path, 'generating');
      try {
        const read = await window.electronAPI.workspace.readTextFile(target.path, path);
        if (!read.success || !read.data) throw new Error(read.error || '读取章节失败');
        const skeleton = read.data.content;
        const prose = skeleton.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/i, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^#+\s+.*$/gm, '').trim();
        if (countArticleWords(prose) > 150 && !skeleton.includes('<!-- 在这里添加内容 -->')) {
          setChapterStatus(path, 'draft'); completed += 1; continue;
        }
        const previousPath = managedFiles[managedFiles.indexOf(path) - 1];
        const nextPath = managedFiles[managedFiles.indexOf(path) + 1];
        let previousEnding = '';
        if (previousPath) {
          const previous = await window.electronAPI.workspace.readTextFile(target.path, previousPath);
          if (previous.success && previous.data) previousEnding = previous.data.content.slice(-1200);
        }
        const chapterEvidence = evidenceRecords.filter((item) => item.chapter === path);
        const evidenceContext = chapterEvidence.map((item) => `- ${item.status === 'verified' ? '已核实' : item.status === 'disputed' ? '有争议' : '检索线索'}｜${item.title}｜${item.source}｜${item.url}\n  ${item.notes}${item.anchor?.quote ? `\n  已绑定正文：${item.anchor.quote}` : ''}`).join('\n') || '无已登记材料。此时只能写范围较窄的分析性草稿；涉及具体数字、引文、争议事件或强因果判断时必须标记待核实。';
        const messages: ChatMessage[] = [
          { role: 'system', content: `你是“${projectTitle}”的历史类图书作者兼事实编辑。根据章节骨架和 chapter-writing-brief 完成本章，但不能把通识概述扩写成看似深刻的散文。

每一节必须回答一个明确问题，并包含：至少两个可辨认的事实或材料锚点、制度或行动如何运作的中间机制，以及该材料能够支持到什么程度。对同一问题存在不同解释时，交代争议边界。区分同时代材料、后世记载与现代研究，不能把后世概括直接当作当时事实。

禁止用“彻底、唯一、必然、完全、从根本上、极度、绝对、致命”等词代替论证；确有必要使用时，必须紧邻给出能够支持该强度的材料。禁止“宏伟蓝图之下、时代洪流、思想火种、致命暗伤、深深裂痕”等模板化升华。避免把复杂群体写成单一心理，不得笼统声称“百姓都……”“知识分子普遍……”。

不得编造史料、引文、卷次、页码、数字、学者观点或人物心理。只把标为“已核实”的材料当作证据；检索线索只能提出核查方向。没有足够材料时，宁可缩小结论并插入“<!-- 待核实：所需材料 -->”，也不要补写成确定事实。保留 YAML、一级标题、chapter-writing-brief、既有小标题、链接和图片，替换占位注释；不要复述上一章或提前写完下一章。直接输出完整 Markdown。` },
          { role: 'user', content: `全书需求：${bookRequirement || '未单独填写'}\n全书知识库（标准写法优先）：\n${knowledgeEntries.map((item) => `- ${item.kind}｜${item.name}｜标准：${item.canonical || item.name}｜别名：${item.aliases}｜${item.notes}`).join('\n') || '暂无'}\n当前章节：${chapterName}\n上一章结尾（仅用于衔接，不得复述）：${previousEnding || '无'}\n下一章：${nextPath?.split('/').pop()?.replace(/\.md$/i, '') || '无'}\n\n本章证据台账：\n${evidenceContext}\n\n章节骨架：\n${skeleton}` },
        ];
        let result = '';
        for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.55, maxTokens: 8_192, stream: true })) {
          if (batchStopRef.current) break;
          result += chunk.delta || '';
        }
        if (batchStopRef.current) { setChapterStatus(path, 'pending'); break; }
        if (!result.trim()) throw new Error('模型未返回正文');
        const written = await window.electronAPI.workspace.writeTextFile(target.path, path, `${result.trimEnd()}\n`, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: read.data.modifiedAt });
        if (!written.success || !written.data) throw new Error(written.error || '写入章节失败');
        setChapterStatus(path, 'draft'); completed += 1;
        if (activeFile === path) { setDocumentContent(`${result.trimEnd()}\n`); setSavedContent(`${result.trimEnd()}\n`); setModifiedAt(written.data.modifiedAt); }
      } catch (error) { setChapterStatus(path, 'error', error instanceof Error ? error.message : String(error)); }
      setBatchProgress({ completed, total: candidates.length, current: chapterName });
    }
    setBatchGenerating(false); setBatchProgress((current) => ({ ...current, completed, current: '' }));
    notice.info({ message: batchStopRef.current ? '批量生成已停止' : '批量生成结束', description: `已处理 ${completed}/${candidates.length} 章；生成结果进入“草稿待确认”状态。`, placement: 'bottomRight' });
  };

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
    setAiLoading(false); setAiResult(''); setAiError(''); setReviewSuggestions([]); setReviewPatches([]);
  }, [activeFile]);

  const dirty = documentContent !== savedContent;
  const activeProject = recentProjects.find((project) => project.rootPath === target?.path && (!project.subfolder || managedFiles.some((path) => path.startsWith(`${project.subfolder}/`)))) ?? null;
  const activeProjectId = activeProject?.id;

  useEffect(() => {
    if (!activeProjectId) return;
    const timer = window.setTimeout(() => {
      setRecentProjects((current) => current.map((project) => project.id === activeProjectId ? {
        ...project,
        requirement: bookRequirement,
        chapterBriefs,
        chapterStatuses,
        knowledgeEntries,
        evidenceRecords,
        qualityReports,
        deploymentStatus,
        git: { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch },
        pages: { title: pagesTitle || projectTitle, description: pagesDescription || `${projectTitle}在线阅读`, author: pagesAuthor || '作者', language: pagesLanguage || 'zh-CN', repositoryName: pagesRepositoryName || 'my-book', customDomain: pagesCustomDomain, accentColor: pagesAccentColor },
        updatedAt: Date.now(),
      } : project));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, bookRequirement, chapterBriefs, chapterStatuses, deploymentStatus, evidenceRecords, gitBranch, gitRemoteName, gitRemoteUrl, knowledgeEntries, pagesAccentColor, pagesAuthor, pagesCustomDomain, pagesDescription, pagesLanguage, pagesRepositoryName, pagesTitle, projectTitle, qualityReports]);

  useEffect(() => {
    if (!activeProjectId || !target || !managedFiles.length) return;
    const timer = window.setTimeout(async () => {
      setManifestSyncState('saving');
      const manifestPath = activeProject?.subfolder ? `${activeProject.subfolder}/.chapter-project.json` : '.chapter-project.json';
      const manifest = `${JSON.stringify({ schemaVersion: 2, version: 2, name: projectTitle, requirement: bookRequirement, source, chapterBriefs, chapterStatuses, knowledgeEntries, evidenceRecords, qualityReports, deploymentStatus, splitMode, organizeByPart, template, files: managedFiles, git: { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch }, pages: { title: pagesTitle, description: pagesDescription, author: pagesAuthor, language: pagesLanguage, repositoryName: pagesRepositoryName, customDomain: pagesCustomDomain, accentColor: pagesAccentColor }, updatedAt: Date.now() }, null, 2)}\n`;
      try {
        const existing = await window.electronAPI.workspace.readTextFile(target.path, manifestPath);
        const result = existing.success && existing.data
          ? await window.electronAPI.workspace.writeTextFile(target.path, manifestPath, manifest, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: existing.data.modifiedAt })
          : await window.electronAPI.workspace.mutateFiles(target.path, [{ kind: 'create', path: manifestPath, content: manifest, encoding: 'utf8', lineEnding: 'LF' }]);
        setManifestSyncState(result.success ? 'saved' : 'error');
      } catch { setManifestSyncState('error'); }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [activeProject, activeProjectId, bookRequirement, chapterBriefs, chapterStatuses, deploymentStatus, evidenceRecords, gitBranch, gitRemoteName, gitRemoteUrl, knowledgeEntries, managedFiles, organizeByPart, pagesAccentColor, pagesAuthor, pagesCustomDomain, pagesDescription, pagesLanguage, pagesRepositoryName, pagesTitle, projectTitle, qualityReports, source, splitMode, target, template]);

  const switchView = (next: 'generator' | 'documents' | 'management') => {
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
      requirement: overrides?.requirement ?? bookRequirement,
      chapterBriefs: overrides?.chapterBriefs ?? chapterBriefs,
      chapterStatuses: overrides?.chapterStatuses ?? chapterStatuses,
      knowledgeEntries: overrides?.knowledgeEntries ?? knowledgeEntries,
      evidenceRecords: overrides?.evidenceRecords ?? evidenceRecords,
      qualityReports: overrides?.qualityReports ?? qualityReports,
      deploymentStatus: overrides?.deploymentStatus ?? deploymentStatus,
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
      const requestedPrefix = projectFolder.trim() ? `${projectFolder.trim().replace(/\\/g, '/')}/` : '';
      const manifestEntry = (result.data ?? []).find((entry) => entry.type === 'file' && entry.path.replace(/\\/g, '/').endsWith('.chapter-project.json'));
      const detectedFolder = manifestEntry?.path.replace(/\\/g, '/').replace(/(^|\/)\.chapter-project\.json$/, '').replace(/\/$/, '') ?? '';
      const prefix = requestedPrefix && (result.data ?? []).some((entry) => entry.path.replace(/\\/g, '/').startsWith(requestedPrefix)) ? requestedPrefix : manifestEntry ? (detectedFolder ? `${detectedFolder}/` : '') : requestedPrefix;
      const allMarkdown = (result.data ?? []).filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.md'))
        .map((entry) => entry.path.replace(/\\/g, '/')).filter((path) => !path.startsWith('.history/') && !path.includes('/.history/'));
      const matched = allMarkdown.filter((path) => !prefix || path.startsWith(prefix));
      const paths = (matched.length ? matched : allMarkdown).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      let diskProject: Partial<SavedProject> | undefined;
      const diskManifest = await window.electronAPI.workspace.readTextFile(folder.path, prefix ? `${prefix}.chapter-project.json` : '.chapter-project.json');
      if (diskManifest.success && diskManifest.data) {
        try {
          diskProject = JSON.parse(diskManifest.data.content) as Partial<SavedProject>;
          setProjectTitle(diskProject.name || folder.name); setSource(diskProject.source || ''); setBookRequirement(diskProject.requirement || '');
          setChapterBriefs(diskProject.chapterBriefs ?? {}); setChapterStatuses(diskProject.chapterStatuses ?? {}); setKnowledgeEntries(diskProject.knowledgeEntries ?? []); setEvidenceRecords(diskProject.evidenceRecords ?? []); setQualityReports(diskProject.qualityReports ?? {}); setDeploymentStatus(diskProject.deploymentStatus ?? { state: 'unconfigured', updatedAt: 0 });
          if (diskProject.git) { setGitRemoteUrl(diskProject.git.remoteUrl || ''); setGitRemoteName(diskProject.git.remoteName || 'origin'); setGitBranch(diskProject.git.branch || 'main'); }
        } catch { notice.warning({ message: '.chapter-project.json 无法解析', placement: 'bottomRight' }); }
      }
      setManagedFiles(paths); setView('documents');
      if (shouldRemember && paths.length) rememberProject(folder, paths, { ...diskProject, subfolder: prefix.replace(/\/$/, '') });
      if (paths.length) await openDocument(paths[0], folder, confirmDiscard);
      else notice.info({ message: '没有找到 Markdown 文档', placement: 'bottomRight' });
    } catch (error) {
      notice.error({ message: '加载失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setDocumentLoading(false); }
  };

  const openSavedProject = async (project: SavedProject) => {
    if (dirty && !window.confirm('当前文档尚未保存，确定打开其他项目吗？')) return;
    try {
      const authorized = await window.electronAPI.workspace.reauthorize(project.rootPath);
      if (!authorized.success) throw new Error('目录授权失败');
      const folder = { path: project.rootPath, name: project.name };
      const manifestPath = project.subfolder ? `${project.subfolder}/.chapter-project.json` : '.chapter-project.json';
      const manifestResult = await window.electronAPI.workspace.readTextFile(project.rootPath, manifestPath);
      let openedProject = project;
      if (manifestResult.success && manifestResult.data) {
        try {
          const disk = JSON.parse(manifestResult.data.content) as Partial<SavedProject>;
          openedProject = { ...project, ...disk, id: project.id, rootPath: project.rootPath, subfolder: project.subfolder, files: Array.isArray(disk.files) ? disk.files : project.files };
        } catch { notice.warning({ message: '项目清单格式错误', description: '已使用本机历史记录打开；请检查 .chapter-project.json。', placement: 'bottomRight' }); }
      }
      setTarget(folder); setProjectTitle(openedProject.name); setSubfolder(openedProject.subfolder); setSource(openedProject.source);
      setBookRequirement(openedProject.requirement ?? '');
      setChapterBriefs(openedProject.chapterBriefs ?? {});
      setChapterStatuses(Object.fromEntries(Object.entries(openedProject.chapterStatuses ?? {}).map(([path, status]) => [path, status.state === 'generating'
        ? { state: 'error', error: '上次批量生成意外中断，可重新生成。', updatedAt: Date.now() } satisfies ChapterGenerationStatus
        : status])));
      setKnowledgeEntries(openedProject.knowledgeEntries ?? []);
      setEvidenceRecords(openedProject.evidenceRecords ?? []);
      setQualityReports(openedProject.qualityReports ?? {});
      setDeploymentStatus(openedProject.deploymentStatus ?? { state: 'unconfigured', updatedAt: 0 });
      setSplitMode(openedProject.splitMode); setOrganizeByPart(openedProject.organizeByPart); setTemplate(openedProject.template);
      setGitRemoteUrl(openedProject.git?.remoteUrl ?? ''); setGitRemoteName(openedProject.git?.remoteName ?? 'origin'); setGitBranch(openedProject.git?.branch ?? 'main');
      const restoredBookTitle = !openedProject.pages?.title || openedProject.pages.title === '我的文档' ? (openedProject.pages?.description?.replace(/在线阅读$/, '') || openedProject.name) : openedProject.pages.title;
      setPagesTitle(restoredBookTitle); setPagesDescription(openedProject.pages?.description ?? `${restoredBookTitle}在线阅读`); setPagesAuthor(openedProject.pages?.author ?? '作者');
      setPagesLanguage(openedProject.pages?.language ?? 'zh-CN'); setPagesRepositoryName(openedProject.pages?.repositoryName ?? 'my-book'); setPagesCustomDomain(openedProject.pages?.customDomain ?? '');
      setPagesAccentColor(openedProject.pages?.accentColor ?? '#6d285f');
      setManagedFiles(openedProject.files); setView('documents'); setActiveFile(''); setDocumentContent(''); setSavedContent('');
      await loadExistingDocuments(folder, openedProject.subfolder, false, false);
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
      setQualityReports((current) => {
        if (!current[activeFile]) return current;
        const next = { ...current };
        delete next[activeFile];
        return next;
      });
      const currentState = chapterStatuses[activeFile]?.state ?? 'pending';
      const nextState = chapterStateAfterSave(currentState);
      if (nextState !== currentState) setChapterStatus(activeFile, nextState);
      if (gateRepairActiveRef.current && currentState === 'quality') {
        const report = inspectChapterQuality(activeFile, documentContent);
        setQualityReports((current) => ({ ...current, [activeFile]: report }));
        if (!report.blockers.length) {
          setChapterStatus(activeFile, 'complete');
          const remaining = gateFixTargetsRef.current.filter((item) => item.path !== activeFile);
          gateFixTargetsRef.current = remaining; setGateFixTargets(remaining);
          notice.success({ key: 'gate-fix-progress', message: '本章问题已修复', description: remaining.length ? `继续处理下一章；还剩 ${remaining.length} 章。` : '全部发布门禁问题已处理，请重新发布。', placement: 'bottomRight' });
          if (remaining[0]) window.setTimeout(() => { void openAiGateFix(remaining[0]); }, 0);
          else gateRepairActiveRef.current = false;
        }
      }
      notice.success({ message: '文档已保存', placement: 'bottomRight' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notice.error({ message: message.includes('FILE_MODIFIED_EXTERNALLY') ? '文件已被外部修改' : '保存失败', description: message.includes('FILE_MODIFIED_EXTERNALLY') ? '请重新加载文件，确认外部改动后再编辑。' : message, placement: 'bottomRight' });
    } finally { setSaving(false); }
  };

  const generateResearchPlan = async () => {
    if (!activeFile || researchPlanLoading) return;
    if (!aiApi.apiKey?.trim()) { setAiError('请先在应用设置中配置 AI API Key。'); return; }
    setResearchPlanLoading(true); setAiError('');
    try {
      const chapterName = activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile;
      const brief = { ...EMPTY_CHAPTER_BRIEF, ...chapterBriefs[activeFile] };
      const ledger = evidenceRecords.filter((item) => item.chapter === activeFile).map((item) => `- ${item.status === 'verified' ? '已核实' : item.status === 'disputed' ? '有争议' : '检索线索'}｜${item.title}｜${item.source}｜${item.notes}`).join('\n') || '暂无证据记录';
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [
        { role: 'system', content: `你是历史研究编辑。正文写作前先制作研究提纲与证据映射，不撰写正文，不补造资料。严格输出以下 Markdown 结构：
## 核心问题
列出本章需要回答的 2—4 个问题。
## 叙事入口
选择一个可由现有材料支持的事件、制度运作或人物选择；禁止虚构场景、对话和心理。
## 分节论证
逐节列出“拟回答问题｜可用证据｜证据类型与形成时间｜分析机制｜结论边界”。没有证据时明确写“材料缺口”。
## 争议与风险
列出数字、引语、群体判断、强因果、后世记载及现代概念等需要核查的内容。
## 补充材料清单
按优先级列出还需要寻找的原始材料或研究问题。检索线索不得标成已证实。` },
        { role: 'user', content: `书名：${projectTitle}\n章节：${chapterName}\n全书要求：${bookRequirement || '未填写'}\n写作目标：${brief.goal || '未填写'}\n核心问题：${brief.keyQuestions || '未填写'}\n必用史料：${brief.requiredSources || '未填写'}\n避免重复：${brief.avoidTopics || '未填写'}\n\n证据台账：\n${ledger}\n\n用户补充资料：\n${aiSources.trim() || '无'}\n\n现有章节骨架：\n${documentContent}` },
      ];
      let result = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.2, maxTokens: 4_000, stream: true })) result += chunk.delta || '';
      if (!result.trim()) throw new Error('模型没有返回研究提纲');
      setResearchPlans((current) => ({ ...current, [activeFile]: result.trim() }));
      notice.success({ message: '研究提纲已生成', description: '请检查证据映射和材料缺口，再生成正文。', placement: 'bottomRight' });
    } catch (error) { setAiError(error instanceof Error ? error.message : String(error)); }
    finally { setResearchPlanLoading(false); }
  };

  const runAi = async (writeToEditor = false) => {
    if (!activeFile || aiLoading) return;
    if (!aiApi.apiKey?.trim()) { setAiError('请先在应用设置中配置 AI API Key。'); return; }
    if (aiMode === 'generate' && !researchPlans[activeFile]?.trim()) { setAiError('请先生成并确认“研究提纲与证据映射”，再生成本章正文。'); return; }
    if (aiMode === 'revise' && !aiInstruction.trim()) { setAiError('请先填写具体修改要求，例如要修改的段落、事实、结构或语气。'); return; }
    const requestId = ++aiRequestRef.current;
    setAiLoading(true); setAiResult(''); setAiError('');
    const chapterName = activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile;
    const modePrompt = aiMode === 'generate'
      ? '根据章节标题和现有骨架撰写完整正文。保留一级标题和合理的标题层级，替换占位注释。'
      : aiMode === 'continue'
        ? '从现有正文最后一句之后直接续写。只输出全新的段落，不输出文章标题、已有小标题、YAML 头信息、已有段落、摘要或承上复述；不要用“上文提到”等方式复述。需要新小节时只能创建尚未出现的标题。'
        : aiMode === 'revise'
          ? '严格按照用户的修改要求编辑现有文章。只改动要求涉及的事实、段落、结构或表达，未被要求修改的内容尽量逐字保留；不得借机重写全文、删减史料脚注或改变 Markdown 头信息。输出修改后的完整正文。'
          : '润色现有正文，改善结构、准确性、连贯性和表达，同时保持原意与 Markdown 标题结构。输出润色后的完整正文。';
    const system = `你是“${projectTitle}”的资深作者兼责任编辑。目标不是把文字写得顺，而是写出信息密度高、论证可靠、具有叙事张力的中文正文。

## 严谨性
1. 每个重要段落遵循“明确观点 → 具体依据或事实 → 分析其意义”的内在结构。结论不能凭空出现，因果关系必须说明中间环节。
2. 人物、时间、地点、制度、术语和数字应前后一致。不得编造史料、数据、引文、来源或人物心理；没有可靠依据时使用“可能”“大致”“现有材料不足以证明”等审慎表达，必要时加入“<!-- 待核实：具体问题 -->”。
3. 区分事实、主流解释和作者判断，不把推测写成定论。存在争议时简洁交代争议边界，而不是假装只有一种答案。
4. 抽象判断至少配一个具体事实、案例、对比或机制解释；案例不能只是换一种说法重复观点。
4.1 不用“彻底、唯一、必然、完全、从根本上、极度、绝对、致命”等词代替论证；确需使用时，紧邻说明证据及适用范围。不要把“六国百姓”“知识分子”等复杂群体写成具有单一态度。
4.2 禁止“宏伟蓝图之下、时代洪流、思想的火种、致命暗伤、深深裂痕”等模板化升华。段落结尾应落在可观察的制度后果、行动选择、材料限制或待解释问题上。
5. 每一节尽量安排至少两个不同类型的“史料锚点”，可从时间节点、人物行动、制度条文、地理条件、器物考古、时人记载或现代研究观点中选择。史料必须被解释，不能只罗列名称。
6. 用户提供的史料优先级最高。只有在用户资料中出现了原文和出处时才可以使用引号作精确引用；不得凭记忆伪造古籍原句、卷次、页码或学者观点。根据常识补充但无法核准出处的内容，只能概述，并标记“<!-- 待核实：需要核对的史料或出处 -->”。
7. 使用用户提供的史料时，在相关句末使用 Markdown 脚注标记（如 [^s1]）；文章最下方必须添加“## 史料与参考资料”，列出对应脚注、材料名称、作者或篇章及链接。AI 搜索摘要只能标为“检索线索，引用前需核对原文”，不得当作正式引文。

## 内容与结构
如现有文档含有 chapter-writing-brief 注释，其中的目标字数、写作目标、核心问题、必用史料和避免重复内容是本章最高优先级约束；保留该注释，不要把注释文字写进正文。
8. 开头直接进入本章的核心矛盾、关键场景或问题，不使用“在历史长河中”“众所周知”“随着时代发展”等万能套话。
9. 每一节只解决一个清晰问题，段落之间用时间、因果、对比或递进关系推进。删除无信息量的承上启下和重复总结。
10. 保持全书边界，不提前写完其他章节；需要铺垫时只提供理解本章所必需的背景。

## 文风
11. 使用准确、具体、有画面感的现代中文。长短句交替，关键判断简洁有力；少用空泛形容词，多用动作、选择、条件和后果呈现内容。
12. 风趣来自事实之间的反差、克制的比喻或机智转场，占比约 10%；不堆网络梗，不油滑，不拿灾难、战争或具体群体开玩笑。
13. 避免 AI 腔：不用“值得注意的是”“不难发现”“综上所述”反复串联，不连续罗列“首先、其次、最后”，不在每节末尾机械升华。

## 输出前自检（只在内部执行，不输出检查过程）
- 删除任何没有新增信息的句子；
- 检查每个强结论是否有依据；
- 检查日期、人物和因果是否自洽；
- 把至少一处平白概述改成具体但不虚构的机制、对比或场景；
- 确认 Markdown 头信息、标题、链接和图片结构完整。

直接输出可写入文件的 Markdown，不使用代码围栏，不解释写作过程，不添加“以下是正文”等开场白。`;
    const context = managedFiles.slice(0, 100).map((path) => path.split('/').pop()?.replace(/\.md$/i, '')).filter(Boolean).join('、');
    const sourceContext = aiSources.trim() || '用户未提供专门史料。只能使用高度确定的通识性史实；不得生成精确引文、卷次或页码，存疑处必须标记待核实。';
    const knowledgeContext = knowledgeEntries.map((item) => `- ${item.kind}｜${item.name}｜标准写法：${item.canonical || item.name}｜别名：${item.aliases}｜${item.notes}`).join('\n') || '暂无项目级知识条目';
    const researchPlan = researchPlans[activeFile]?.trim() || '尚未制作研究提纲。写作时必须自行收缩无证据结论，并标记材料缺口。';
    const user = `当前章节：${chapterName}\n全书章节：${context}\n全书知识库：\n${knowledgeContext}\n任务：${modePrompt}${aiInstruction.trim() ? `\n用户补充要求：${aiInstruction.trim()}` : ''}\n\n已确认的研究提纲与证据映射：\n${researchPlan}\n\n用户提供的史料与参考资料：\n${sourceContext}\n\n现有文档：\n${documentContent}`;
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
      let result = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.55, maxTokens: 8_192, stream: true })) {
        if (requestId !== aiRequestRef.current) return;
        if (chunk.delta) { result += chunk.delta; setAiResult(result); }
      }
      if (!result.trim()) throw new Error('AI 没有返回内容，请重试。');
      result = aiMode === 'continue' ? removeRepeatedContinuation(documentContent, result) : appendSourceReferences(result, aiSources);
      if (!result.trim()) throw new Error('续写结果与现有文章重复，已阻止写入。请补充下一段要写的事件或新小节标题后重试。');
      setAiResult(result);
      if (writeToEditor && requestId === aiRequestRef.current) {
        const next = aiMode === 'continue' ? insertBeforeSourceReferences(documentContent, result) : `${result.trimEnd()}\n`;
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
    setDocumentContent((current) => method === 'replace' ? aiResult.trimEnd() + '\n' : insertBeforeSourceReferences(current, aiMode === 'continue' ? removeRepeatedContinuation(current, aiResult) : aiResult));
    setAiOpen(false); setReviewOpen(false); setEditorMode('edit');
  };

  const runReview = async () => {
    if (!activeFile || aiLoading) return;
    if (!normalizeApiKey(reviewApiKey) || !reviewBaseUrl.trim() || !reviewModel.trim()) { setAiError('请完整填写审校模型地址、API Key 和模型名。'); return; }
    if (!isValidApiKey(reviewApiKey)) { setAiError('API Key 含有中文、空格或其他无效字符。请清空后从 MiniMax 控制台重新复制完整 Key。'); return; }
    const requestId = ++aiRequestRef.current;
    setAiLoading(true); setAiResult(''); setAiError(''); setReviewSuggestions([]); setReviewPatches([]);
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
      setReviewSuggestions(parseReviewSuggestions(result));
      setChapterStatus(activeFile, 'revising');
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

  const generateReviewPatches = async () => {
    const accepted = reviewSuggestions.filter((item) => item.decision === 'accepted');
    if (!accepted.length || reviewPatchLoading) { notice.warning({ message: '请先采纳至少一条审校意见', placement: 'bottomRight' }); return; }
    if (!aiApi.apiKey?.trim()) { notice.warning({ message: '请先配置助写模型', placement: 'bottomRight' }); return; }
    setReviewPatchLoading(true); setReviewPatches([]);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是谨慎的中文文稿修订器。根据已采纳意见，只修改意见涉及的最小完整段落。输出严格 JSON 数组，每项字段 suggestionId、original、replacement。original 必须逐字复制用户正文中的一个连续完整段落；replacement 是修改后的完整段落。不得改动其他段落，不得输出代码围栏。若意见无法安全落实，则不要输出该项。' },
        { role: 'user', content: `已采纳意见：\n${accepted.map((item) => `[${item.id}] 位置：${item.position}\n问题：${item.issue}\n建议：${item.suggestion}`).join('\n\n')}\n\n当前正文：\n${documentContent}` },
      ];
      let raw = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.15, maxTokens: 8_000, stream: false })) raw += chunk.delta || '';
      const json = raw.match(/\[[\s\S]*\]/)?.[0];
      if (!json) throw new Error('模型没有返回可解析的段落修改');
      const parsed = JSON.parse(json) as Array<{ suggestionId?: string; original?: string; replacement?: string }>;
      const patches = parsed.filter((item) => item.original?.trim() && item.replacement?.trim() && item.original !== item.replacement).slice(0, 20).map((item, index) => ({ id: `patch-${Date.now()}-${index}`, suggestionId: String(item.suggestionId || ''), original: String(item.original).trim(), replacement: String(item.replacement).trim(), state: documentContent.includes(String(item.original).trim()) ? 'ready' as const : 'conflict' as const }));
      if (!patches.length) throw new Error('没有生成可安全定位的段落修改');
      setReviewPatches(patches);
    } catch (error) {
      notice.error({ message: '生成段落修改失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally { setReviewPatchLoading(false); }
  };

  const applyReviewReport = async () => {
    const accepted = reviewSuggestions.filter((item) => item.decision === 'accepted');
    if (!aiResult.trim() || !accepted.length || reviewPatchLoading) return;
    if (!normalizeApiKey(reviewApiKey) || !reviewBaseUrl.trim() || !reviewModel.trim()) {
      notice.warning({ message: '请先完整配置审校模型', placement: 'bottomRight' });
      return;
    }
    if (!window.confirm(`将按已采纳的 ${accepted.length} 条意见修改完整正文。此操作改动范围较大，修改后仍需人工确认，是否继续？`)) return;
    setReviewPatchLoading(true);
    try {
      const provider = createOpenAIProvider({
        apiKey: normalizeApiKey(reviewApiKey),
        baseUrl: reviewBaseUrl.trim(),
        chatProxy: window.electronAPI.llmChat,
      });
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `你是谨慎的中文责任编辑。请依据校审报告直接修订正文，并只输出修订后的完整 Markdown 正文。

要求：
1. 落实报告中“必须修改”和能够安全落实的“建议修改”；可选扩写仅在报告给出充分依据、且不需要编造事实时处理。
2. 对标记为“需人工核实”、证据不足或无法确认的内容，不得自行编造结论；保留原文，必要时用简洁的“<!-- 待核实：... -->”注释标记。
3. 保留原有标题层级、脚注、链接、图片、引用和“史料与参考资料”章节，不得删减与报告无关的内容。
4. 不输出修改说明、摘要、前言或代码围栏，只输出可直接保存的完整文章。`,
        },
        { role: 'user', content: `仅执行以下已采纳意见，忽略审校报告中的其他意见：\n\n${accepted.map((item) => `位置：${item.position}\n问题：${item.issue}\n建议：${item.suggestion}`).join('\n\n')}\n\n待修改正文：\n\n${documentContent}` },
      ];
      let revised = '';
      for await (const chunk of provider.chat(messages, { model: reviewModel.trim(), temperature: 0.15, maxTokens: 16_000, stream: false })) revised += chunk.delta || '';
      revised = revised.trim().replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
      if (!revised) throw new Error('审校模型没有返回修改后的正文');
      setDocumentContent(`${revised}\n`);
      setReviewPatches([]);
      setEditorMode('edit');
      notice.success({ message: '已按照校审报告修改正文', description: '修改尚未保存，请检查正文后点击“保存”。', placement: 'bottomRight' });
    } catch (error) {
      notice.error({ message: '按照报告修改失败', description: error instanceof Error ? error.message : String(error), placement: 'bottomRight' });
    } finally {
      setReviewPatchLoading(false);
    }
  };

  const toggleReviewPatch = (patch: ReviewPatch) => {
    if (patch.state === 'conflict') return;
    if (patch.state === 'ready') {
      if (!documentContent.includes(patch.original)) { setReviewPatches((current) => current.map((item) => item.id === patch.id ? { ...item, state: 'conflict' } : item)); return; }
      setDocumentContent((current) => current.replace(patch.original, patch.replacement));
      setReviewPatches((current) => current.map((item) => item.id === patch.id ? { ...item, state: 'applied' } : item));
    } else {
      if (!documentContent.includes(patch.replacement)) { setReviewPatches((current) => current.map((item) => item.id === patch.id ? { ...item, state: 'conflict' } : item)); return; }
      setDocumentContent((current) => current.replace(patch.replacement, patch.original));
      setReviewPatches((current) => current.map((item) => item.id === patch.id ? { ...item, state: 'ready' } : item));
    }
  };

  const researchHistoricalSources = async () => {
    if (!activeFile || sourceResearchLoading) return;
    const chapterName = activeFile.split('/').pop()?.replace(/\.md$/i, '') ?? activeFile;
    const fallbackQueries = [
      `${projectTitle} ${chapterName} 史料 原始文献`,
      `${chapterName} 论文 site:cnki.net OR site:wanfangdata.com.cn`,
      `${chapterName} 研究 site:ncpssd.cn OR site:cssn.cn OR site:edu.cn`,
    ];
    setSourceResearchLoading(true); setSourceResearchError(''); setSourceResearchResults([]);
    try {
      let queries = fallbackQueries;
      if (isValidApiKey(reviewApiKey)) {
        try {
          const planner = createOpenAIProvider({ apiKey: normalizeApiKey(reviewApiKey), baseUrl: reviewBaseUrl.trim(), chatProxy: window.electronAPI.llmChat });
          const planningMessages: ChatMessage[] = [
            { role: 'system', content: '你是历史研究助理。根据书名、章节名和正文主题，生成 3 条互补的中文检索词：第 1 条寻找原始文献、史书或考古材料；第 2 条必须用 site:cnki.net OR site:wanfangdata.com.cn 定向寻找中文论文；第 3 条必须用 site:ncpssd.cn OR site:cssn.cn OR site:edu.cn 寻找国家哲学社会科学文献中心、中国社会科学网或高校机构库资料。只输出 JSON 字符串数组，不解释，不虚构论文标题或来源。' },
            { role: 'user', content: `书名：${projectTitle}\n章节：${chapterName}\n正文片段：${documentContent.replace(/^---[\s\S]*?---/, '').slice(0, 1800)}` },
          ];
          let raw = '';
          for await (const chunk of planner.chat(planningMessages, { model: reviewModel.trim(), temperature: 0.25, maxTokens: 600, stream: false })) raw += chunk.delta || '';
          const json = raw.match(/\[[\s\S]*\]/)?.[0];
          const parsed = json ? JSON.parse(json) : null;
          if (Array.isArray(parsed)) {
            const planned = parsed.map((item) => String(item).trim()).filter(Boolean).slice(0, 3);
            if (planned.length === 3) queries = planned;
          }
        } catch { queries = fallbackQueries; }
      }
      setSourceResearchQueries(queries);
      const [workSearches, historicalSearch] = await Promise.all([
        Promise.allSettled(queries.map((text) => window.electronAPI.workBrowser.search.run({ text, locale: 'zh-CN', perPage: 6, scope: 'web' }))),
        window.electronAPI.outlineResearch.search(queries).catch((error) => ({ results: [], providers: [{ providerId: 'historical-fallback', ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }] })),
      ]);
      const unique = new Map<string, ResearchSourceCard>();
      const workResults = workSearches.flatMap((entry) => entry.status === 'fulfilled' ? entry.value.results ?? [] : []);
      [...workResults, ...historicalSearch.results].forEach((item: { id?: string; title?: string; url?: string; snippet?: string; domain?: string; source?: string }) => {
        const url = String(item.url || '').trim();
        if (!/^https?:\/\//i.test(url) || unique.has(url)) return;
        unique.set(url, { id: url, title: String(item.title || url), url, snippet: String(item.snippet || '').trim(), domain: String(item.domain || new URL(url).hostname), source: String(item.source || 'web'), selected: false });
      });
      const sourcePriority = (item: ResearchSourceCard) => {
        if (/(?:cnki\.net|wanfangdata\.com\.cn|ncpssd\.cn|cssn\.cn|\.edu\.cn)$/i.test(item.domain)) return 0;
        if (item.source === 'openalex' || item.source === 'crossref' || item.source === 'wikisource') return 1;
        if (item.source === 'wikipedia') return 3;
        return 2;
      };
      const cards = [...unique.values()].sort((a, b) => sourcePriority(a) - sourcePriority(b)).slice(0, 15);
      setSourceResearchResults(cards);
      if (!cards.length) {
        const workErrors = workSearches.flatMap((entry) => entry.status === 'rejected' ? [entry.reason instanceof Error ? entry.reason.message : String(entry.reason)] : entry.value.providers.filter((provider) => !provider.ok).map((provider) => `${provider.providerId}: ${provider.error || '失败'}`));
        const fallbackErrors = historicalSearch.providers.filter((provider) => !provider.ok).map((provider) => `${provider.providerId}: ${provider.error || '失败'}`);
        const details = [...new Set([...workErrors, ...fallbackErrors])].slice(0, 5).join('；');
        setSourceResearchError(`没有搜索到可用结果。${details ? `搜索源返回：${details}` : '请检查当前网络或代理设置。'}`);
      }
    } catch (error) {
      setSourceResearchError(error instanceof Error ? error.message : String(error));
    } finally { setSourceResearchLoading(false); }
  };

  const addSelectedResearchSources = () => {
    const selected = sourceResearchResults.filter((item) => item.selected);
    if (!selected.length) return;
    const material = selected.map((item, index) => `${index + 1}. [${item.title}](${item.url})\n   - 来源：${item.domain || item.source}\n   - 搜索摘要（仅作线索，写作前需打开原文核对）：${item.snippet || '无摘要'}`).join('\n');
    setAiSources((current) => `${current.trim()}${current.trim() ? '\n\n' : ''}## AI 搜集的史料线索\n${material}\n`);
    setEvidenceRecords((current) => {
      const known = new Set(current.map((item) => item.url));
      return [...current, ...selected.filter((item) => !known.has(item.url)).map((item) => ({ id: `${Date.now()}-${item.id}`, title: item.title, url: item.url, source: item.domain || item.source, chapter: activeFile, status: 'clue' as const, notes: item.snippet, createdAt: Date.now() }))];
    });
    notice.success({ message: `已加入 ${selected.length} 条史料线索`, description: '这些是搜索摘要，建议打开原文核对后再生成文章。', placement: 'bottomRight' });
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
      const alt = imagePrompt.trim().replaceAll('[', '').replaceAll(']', '').slice(0, 80) || '章节插图';
      setDocumentContent((current) => `${current.trimEnd()}\n\n![${alt}](${relativePath})\n`);
      setImageOpen(false); setEditorMode('edit');
      notice.success({ message: '插图已保存并插入', description: imagePath, placement: 'bottomRight' });
    } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
  };

  const getProjectGitChanges = async (projectFiles = managedFiles) => {
    if (!target) return [];
      const result = await window.electronAPI.workspace.gitStatus(target.path);
      if (!result.success) throw new Error(result.error);
      setGitRepository(true);
      setOutputIsGitRepository(true);
      const prefix = activeProject?.subfolder || (subfolder.trim() && managedFiles[0]?.includes('/') ? managedFiles[0].split('/')[0] : '');
      const known = new Set([...projectFiles, prefix ? `${prefix}/README.md` : 'README.md', prefix ? `${prefix}/index.md` : 'index.md', prefix ? `${prefix}/404.md` : '404.md', prefix ? `${prefix}/_config.yml` : '_config.yml', prefix ? `${prefix}/.chapter-project.json` : '.chapter-project.json', prefix ? `${prefix}/_data/chapters.yml` : '_data/chapters.yml', prefix ? `${prefix}/_layouts/default.html` : '_layouts/default.html', prefix ? `${prefix}/_layouts/article.html` : '_layouts/article.html', prefix ? `${prefix}/_layouts/home.html` : '_layouts/home.html', prefix ? `${prefix}/assets/css/reader.css` : 'assets/css/reader.css', '.github/workflows/pages.yml']);
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

  const runPublishGate = async (): Promise<string[]> => {
    if (!target) return ['未选择项目目录'];
    const issues: string[] = [];
    if (dirty) issues.push('当前文档有未保存修改');
    if (manifestSyncState === 'saving') issues.push('.chapter-project.json 正在同步，请稍后重试');
    if (manifestSyncState === 'error') issues.push('.chapter-project.json 同步失败');
    const chapterFiles = managedFiles.filter((path) => path.toLowerCase().endsWith('.md') && !/(?:^|\/)(?:README|index|404)\.md$/i.test(path));
    const reports: Record<string, ChapterQualityReport> = { ...qualityReports };
    const nextStatuses: Record<string, ChapterGenerationStatus> = { ...chapterStatuses };
    const fixTargets: GateFixTarget[] = [];
    for (const path of chapterFiles) {
      const read = await window.electronAPI.workspace.readTextFile(target.path, path);
      if (!read.success || !read.data) { issues.push(`${path} 无法读取`); nextStatuses[path] = { state: 'error', error: '发布检查时无法读取', updatedAt: Date.now() }; continue; }
      const report = inspectChapterQuality(path, read.data.content);
      reports[path] = report;
      report.blockers.forEach((item) => issues.push(`${path.split('/').pop()}：${item}`));
      if (report.blockers.length) fixTargets.push({ path, blockers: report.blockers });
      nextStatuses[path] = report.blockers.length
        ? { state: 'quality', error: report.blockers.join('；'), updatedAt: Date.now() }
        : { state: 'complete', updatedAt: Date.now() };
    }
    setQualityReports(reports); setChapterStatuses(nextStatuses); setGateFixTargets(fixTargets); gateFixTargetsRef.current = fixTargets;
    const listing = await window.electronAPI.workspace.listFiles(target.path);
    if (listing.success) {
      const paths = new Set((listing.data ?? []).filter((entry) => entry.type === 'file').map((entry) => entry.path.replace(/\\/g, '/')));
      const siteFolder = activeProject?.subfolder || (subfolder.trim() && managedFiles[0]?.includes('/') ? managedFiles[0].split('/')[0] : '');
      for (const required of [siteFolder ? `${siteFolder}/_config.yml` : '_config.yml', siteFolder ? `${siteFolder}/_data/chapters.yml` : '_data/chapters.yml', '.github/workflows/pages.yml', siteFolder ? `${siteFolder}/.chapter-project.json` : '.chapter-project.json']) if (!paths.has(required)) issues.push(`发布文件缺失：${required}`);
    }
    if (!gitRemoteUrl.trim()) issues.push('未配置远程 Git 仓库');
    const uniqueIssues = [...new Set(issues)];
    if (!uniqueIssues.length) {
      const manifestPath = activeProject?.subfolder ? `${activeProject.subfolder}/.chapter-project.json` : '.chapter-project.json';
      const existing = await window.electronAPI.workspace.readTextFile(target.path, manifestPath);
      const manifest = `${JSON.stringify({ schemaVersion: 2, version: 2, name: projectTitle, requirement: bookRequirement, source, chapterBriefs, chapterStatuses: nextStatuses, knowledgeEntries, evidenceRecords, qualityReports: reports, deploymentStatus, splitMode, organizeByPart, template, files: managedFiles, git: { remoteUrl: gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch }, pages: { title: pagesTitle, description: pagesDescription, author: pagesAuthor, language: pagesLanguage, repositoryName: pagesRepositoryName, customDomain: pagesCustomDomain, accentColor: pagesAccentColor }, updatedAt: Date.now() }, null, 2)}\n`;
      const synced = existing.success && existing.data ? await window.electronAPI.workspace.writeTextFile(target.path, manifestPath, manifest, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: existing.data.modifiedAt }) : { success: false, error: '项目清单不存在' };
      if (!synced.success) uniqueIssues.push(`项目清单同步失败：${synced.error || '未知错误'}`); else setManifestSyncState('saved');
    }
    setPublishGateIssues(uniqueIssues);
    return uniqueIssues;
  };

  const openAiGateFix = async (targetIssue = gateFixTargets[0]) => {
    if (!targetIssue || !target) return;
    gateRepairActiveRef.current = true;
    await openDocument(targetIssue.path, target, true);
    const read = await window.electronAPI.workspace.readTextFile(target.path, targetIssue.path);
    if (!read.success || !read.data) { notice.error({ message: '无法读取待修复章节', description: read.error, placement: 'bottomRight' }); return; }
    const brief = { ...EMPTY_CHAPTER_BRIEF, ...chapterBriefs[targetIssue.path] };
    const hasVerificationIssue = targetIssue.blockers.some((item) => item.includes('待核实'));
    const hasLengthIssue = targetIssue.blockers.some((item) => item.includes('字'));
    const instructions = [
      '只处理下面列出的发布门禁问题，未涉及的段落、Markdown 头信息、标题、图片、链接和脚注保持不变。输出修改后的完整文章。',
      ...targetIssue.blockers.map((item) => `- ${item}`),
      hasVerificationIssue ? '逐一定位 <!-- 待核实：... -->。如果项目中已有核实证据，依据证据修正并在句末标注来源；没有证据时，不得猜测或编造，应删除无依据的精确细节，或改写成明确、审慎且不超出已知材料的表述。只有问题确实消除后才删除待核实标记。' : '',
      hasLengthIssue ? `在不重复其他章节的前提下，将正文扩充到至少 ${Math.ceil(brief.targetWords * 0.72)} 字。优先补充因果链、制度背景、事件过程、不同解释和具体证据，不使用空话凑字数。` : '',
      `本章写作目标：${brief.goal || '遵循现有主题'}`,
      `本章必用史料：${brief.requiredSources || '未指定；不得虚构来源'}`,
    ].filter(Boolean).join('\n');
    setAiMode('revise'); setAiInstruction(instructions); setAiResult(''); setAiError('');
    const chapterEvidence = evidenceRecords.filter((item) => item.chapter === targetIssue.path).map((item) => `- [${item.title}](${item.url})｜${item.status === 'verified' ? '已核实' : item.status === 'disputed' ? '存在争议' : '仅为检索线索'}｜${item.notes}`).join('\n');
    setAiSources(chapterEvidence || '本章没有已登记史料。不得生成精确引文、卷次、页码或未经证实的具体数据。');
    setView('documents'); setGitOpen(false); setReviewOpen(false); setImageOpen(false); setAiOpen(true); setEditorMode('edit');
    if (!aiApi.apiKey?.trim()) {
      setAiError('已定位发布门禁问题。配置助写模型后点击“生成预览”，或根据上方修复要求手动修改。');
      return;
    }
    const requestId = ++aiRequestRef.current;
    setAiLoading(true);
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是严谨的中文图书责任编辑。修复发布门禁问题时，准确性优先于顺畅：不得编造史料、引文、页码、数字或人物心理；没有证据时应删除无依据的精确细节或改为审慎表述。扩写必须增加事实、机制、因果和必要背景，不能复述原文或用空话凑字数。只输出修改后的完整 Markdown，不解释过程。' },
        { role: 'user', content: `书名：${projectTitle}\n章节：${targetIssue.path.split('/').pop()}\n\n修复要求：\n${instructions}\n\n项目知识库：\n${knowledgeEntries.map((item) => `- ${item.name}｜标准：${item.canonical || item.name}｜${item.notes}`).join('\n') || '暂无'}\n\n可用证据：\n${chapterEvidence || '无。不得虚构来源。'}\n\n当前正文：\n${read.data.content}` },
      ];
      let result = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.35, maxTokens: 10_000, stream: true })) {
        if (requestId !== aiRequestRef.current) return;
        result += chunk.delta || ''; setAiResult(result);
      }
      if (!result.trim()) throw new Error('模型没有返回修订内容');
      notice.success({ message: 'AI 门禁修复预览已生成', description: '请核对右侧结果，确认无误后点击“替换文档”并保存。', placement: 'bottomRight' });
    } catch (error) {
      if (requestId === aiRequestRef.current) setAiError(error instanceof Error ? error.message : String(error));
    } finally { if (requestId === aiRequestRef.current) setAiLoading(false); }
  };

  const publishToRemote = async (allowQualityIssues = false) => {
    if (!target || !gitRemoteUrl.trim() || !gitRemoteName.trim() || !gitBranch.trim()) return;
    if (/^https?:\/\/[^/@]+@/i.test(gitRemoteUrl.trim())) { setGitError('远程地址中不要包含用户名、Token 或密码，请使用 Git Credential Manager。'); return; }
    const gateIssues = await runPublishGate();
    if (gateIssues.length) {
      const qualityIssueSet = new Set(gateFixTargetsRef.current.flatMap((item) => item.blockers.map((blocker) => `${item.path.split('/').pop()}：${blocker}`)));
      const hardIssues = gateIssues.filter((item) => !qualityIssueSet.has(item));
      const canOverride = hardIssues.length === 0 && qualityIssueSet.size > 0;
      setPublishCanOverride(canOverride);
      if (hardIssues.length) {
        setGitError(`暂时无法提交：${hardIssues.slice(0, 5).join('；')}${hardIssues.length > 5 ? `；另有 ${hardIssues.length - 5} 项` : ''}`);
        return;
      }
      if (!allowQualityIssues) {
        setGitError(`发现 ${gateFixTargetsRef.current.length} 章质量问题。可以先处理，也可以确认后忽略并提交。`);
        return;
      }
    }
    const publishFiles = await configureGitHubPages(true);
    if (!publishFiles) return;
    setPublishCanOverride(false); setGitLoading(true); setGitError(''); setDeploymentStatus({ state: 'publishing', message: allowQualityIssues ? '正在忽略质量提示并推送' : '正在提交并推送', updatedAt: Date.now() });
    try {
      if (gitRepository !== true) {
        const initialized = await window.electronAPI.workspace.gitInit(target.path);
        if (!initialized.success) throw new Error(initialized.error);
        setGitRepository(true); setOutputIsGitRepository(true);
      }
      const changes = await getProjectGitChanges(publishFiles);
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
      const repositoryUrl = gitRemoteUrl.trim().replace(/\.git$/i, '').replace(/^git@github\.com:/i, 'https://github.com/');
      const pagesUrl = pagesCustomDomain.trim() ? `https://${pagesCustomDomain.trim().replace(/^https?:\/\//, '')}` : repositoryUrl.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i, 'https://$1.github.io/$2/');
      setDeploymentStatus({ state: 'published', url: pagesUrl, message: `${gitRemoteName.trim()}/${gitBranch.trim()} 已推送`, updatedAt: Date.now() });
      persistDeploymentSettings();
      setGitChanges(await getProjectGitChanges());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message); setDeploymentStatus({ state: 'failed', message, updatedAt: Date.now() });
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

  const configureGitHubPages = async (silent: boolean | React.MouseEvent = false): Promise<string[] | null> => {
    const quiet = silent === true;
    if (!target || !managedFiles.length) return null;
    if (dirty) { setGitError('当前文档尚未保存，请先保存后再生成 Pages 配置。'); return null; }
    setGitLoading(true); setGitError('');
    try {
      const siteFolder = activeProject?.subfolder || (subfolder.trim() && managedFiles[0]?.includes('/') ? managedFiles[0].split('/')[0] : '');
      const inSite = (name: string) => siteFolder ? `${siteFolder}/${name}` : name;
      const bookTitle = pagesTitle.trim() && pagesTitle.trim() !== '我的文档' ? pagesTitle.trim() : (pagesDescription.trim().replace(/在线阅读$/, '') || projectTitle);
      const listing = await window.electronAPI.workspace.listFiles(target.path);
      if (!listing.success) throw new Error(listing.error || '无法扫描项目章节');
      const folderPrefix = siteFolder ? `${siteFolder}/` : '';
      const diskChapterFiles = (listing.data ?? [])
        .filter((entry) => entry.type === 'file')
        .map((entry) => entry.path.replace(/\\/g, '/'))
        .filter((path) => !folderPrefix || path.startsWith(folderPrefix))
        .filter((path) => !path.includes('/.history/') && !path.startsWith('.history/'))
        .filter((path) => /(?:^|\/)\d+-[^/]+\.md$/i.test(path));
      const chapterFiles = sortChapterPaths([
        ...managedFiles.filter((path) => path.toLowerCase().endsWith('.md') && !/(?:^|\/)(?:README|index|404)\.md$/i.test(path)),
        ...diskChapterFiles,
      ]);
      if (!chapterFiles.length) throw new Error('没有找到可发布的章节文件');
      setManagedFiles(chapterFiles);
      const chapterIndex: Array<{ order: number; title: string; url: string }> = [];
      for (const [order, file] of chapterFiles.entries()) {
        const read = await window.electronAPI.workspace.readTextFile(target.path, file);
        if (!read.success || !read.data) throw new Error(`章节读取失败：${file}：${read.error || '未知错误'}`);
        const title = file.split('/').pop()?.replace(/\.md$/i, '').replace(/^\d+-/, '') ?? '文章';
        const relativePath = siteFolder && file.startsWith(`${siteFolder}/`) ? file.slice(siteFolder.length + 1) : file;
        chapterIndex.push({ order: order + 1, title, url: `/${encodeURI(relativePath.replace(/\.md$/i, '.html'))}` });
        const body = read.data.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n+/, '').replace(/^#\s+.*\r?\n+/, '');
        const content = `---\nlayout: article\ntitle: ${JSON.stringify(title)}\nchapter: true\norder: ${order + 1}\n---\n\n${body}`;
        const updated = await window.electronAPI.workspace.writeTextFile(target.path, file, content, { encoding: 'utf8', lineEnding: 'LF', expectedModifiedAt: read.data.modifiedAt });
        if (!updated.success) throw new Error(`章节配置写入失败：${file}：${updated.error || '未知错误'}`);
      }
      const baseUrl = pagesRepositoryName.trim() ? `/${pagesRepositoryName.trim().replace(/^\/+|\/+$/g, '')}` : '';
      const config = `title: ${JSON.stringify(pagesTitle.trim() || projectTitle)}\ndescription: ${JSON.stringify(pagesDescription.trim())}\nauthor: ${JSON.stringify(pagesAuthor.trim())}\nlang: ${JSON.stringify(pagesLanguage.trim() || 'zh-CN')}\nbaseurl: ${JSON.stringify(baseUrl)}\nurl: ${JSON.stringify(pagesCustomDomain.trim() ? `https://${pagesCustomDomain.trim().replace(/^https?:\/\//, '')}` : '')}\nplugins:\n  - jekyll-feed\n  - jekyll-seo-tag\nexclude:\n  - .history\n  - .chapter-project.json\n`;
      const index = `---\nlayout: home\ntitle: ${JSON.stringify(pagesTitle.trim() || projectTitle)}\n---\n\n${pagesDescription.trim() || `${projectTitle}在线阅读`}\n`;
      const notFound = `---\nlayout: default\ntitle: 页面未找到\npermalink: /404.html\n---\n\n# 页面未找到\n\n这页似乎比作者先下班了。请返回[首页]({{ site.baseurl }}/)。\n`;
      const resolvedConfig = config.replace(JSON.stringify(pagesTitle.trim() || projectTitle), JSON.stringify(bookTitle));
      const resolvedIndex = index.replace(JSON.stringify(pagesTitle.trim() || projectTitle), JSON.stringify(bookTitle));
      const defaultLayout = `<!doctype html>\n<html lang="{{ site.lang | default: 'zh-CN' }}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  {% seo %}\n  {% feed_meta %}\n  <link rel="stylesheet" href="{{ '/assets/css/reader.css' | relative_url }}">\n</head>\n<body>\n  <header class="mobile-header"><a href="{{ '/' | relative_url }}">{{ site.title }}</a><button onclick="document.body.classList.toggle('nav-open')" aria-label="切换目录">目录</button></header>\n  <div class="book-shell">\n    <aside class="book-nav">\n      <a class="brand" href="{{ '/' | relative_url }}"><span class="brand-mark">阅</span><span><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span></a>\n      <nav><div class="nav-label">章节目录</div><ol>{% assign chapters = site.data.chapters | sort: 'order' %}{% for chapter in chapters %}<li><a href="{{ chapter.url | relative_url }}"><span>{{ chapter.order | prepend: '0' | slice: -2, 2 }}</span>{{ chapter.title }}</a></li>{% endfor %}</ol></nav>\n      <footer>{{ site.author }} · {{ 'now' | date: '%Y' }}</footer>\n    </aside>\n    <main class="book-main">{{ content }}</main>\n  </div>\n</body>\n</html>\n`;
      const collapsibleLayout = defaultLayout
        .replace('<aside class="book-nav">\n      <a class="brand"', '<aside class="book-nav">\n      <button class="nav-toggle" onclick="toggleBookNav()" title="折叠或展开章节目录" aria-label="折叠或展开章节目录">‹</button>\n      <a class="brand"')
        .replace('<span><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span>', '<span class="brand-copy"><strong>{{ site.title }}</strong><small>{{ site.description }}</small></span>')
        .replace('</span>{{ chapter.title }}</a>', '</span><b>{{ chapter.title }}</b></a>')
        .replace('  </div>\n</body>', `  </div>\n  <script>const navKey='book-nav-collapsed';if(localStorage.getItem(navKey)==='1')document.body.classList.add('nav-collapsed');function toggleBookNav(){document.body.classList.toggle('nav-collapsed');localStorage.setItem(navKey,document.body.classList.contains('nav-collapsed')?'1':'0')}</script>\n</body>`);
      const articleLayout = `---\nlayout: default\n---\n<article class="reading"><div class="eyebrow">第 {{ page.order }} 章</div><h1>{{ page.title }}</h1><div class="divider"></div>{{ content }}</article>\n`;
      const homeLayout = `---\nlayout: default\n---\n{% assign chapters = site.data.chapters | sort: 'order' %}<section class="hero"><span class="hero-kicker">在线阅读</span><h1>{{ site.title }}</h1><p>{{ content | strip_html }}</p><a class="start-reading" href="{{ chapters.first.url | relative_url }}">开始阅读 →</a></section><section class="chapter-section"><div class="section-heading"><span>CONTENTS</span><h2>章节目录</h2></div><div class="chapter-grid">{% for chapter in chapters %}<a class="chapter-card" href="{{ chapter.url | relative_url }}"><span>{{ chapter.order | prepend: '0' | slice: -2, 2 }}</span><h3>{{ chapter.title }}</h3><em>阅读本章 →</em></a>{% endfor %}</div></section>\n`;
      const accent = /^#[0-9a-f]{6}$/i.test(pagesAccentColor) ? pagesAccentColor : '#6d285f';
      const css = `:root{--accent:${accent};--accent-soft:color-mix(in srgb,var(--accent) 10%,white);--paper:#fbfaf8;--ink:#252220;--muted:#766f69;--line:#e7e1dc;--nav:300px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",serif;-webkit-font-smoothing:antialiased}.book-shell{min-height:100vh}.book-nav{position:fixed;inset:0 auto 0 0;width:var(--nav);display:flex;flex-direction:column;padding:32px 22px;background:#fff;border-right:1px solid var(--line);overflow:auto}.brand{display:flex;gap:13px;align-items:center;color:inherit;text-decoration:none}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--accent);color:#fff;font-size:20px}.brand strong,.brand small{display:block}.brand strong{font-size:18px}.brand small{max-width:180px;margin-top:3px;color:var(--muted);font:12px/1.4 system-ui,sans-serif}.book-nav nav{margin-top:42px}.nav-label{margin:0 10px 12px;color:#aaa;font:600 11px system-ui,sans-serif;letter-spacing:.16em}.book-nav ol{margin:0;padding:0;list-style:none}.book-nav li a{display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:9px;color:#514b47;text-decoration:none;font:14px/1.45 system-ui,sans-serif}.book-nav li a span{color:#aaa;font-size:11px}.book-nav li a:hover,.book-nav li a.active{background:var(--accent-soft);color:var(--accent)}.book-nav footer{margin-top:auto;padding:28px 10px 0;color:#aaa;font:11px system-ui,sans-serif}.book-main{margin-left:var(--nav);min-height:100vh}.reading{max-width:820px;margin:0 auto;padding:80px 56px 120px}.reading .eyebrow,.hero-kicker{color:var(--accent);font:600 12px system-ui,sans-serif;letter-spacing:.18em}.reading h1{margin:12px 0 22px;font-size:42px;line-height:1.25}.divider{width:52px;height:3px;margin-bottom:46px;background:var(--accent)}.reading h2{margin:2.2em 0 .8em;font-size:26px}.reading h3{margin:1.8em 0 .7em;font-size:20px}.reading p,.reading li{font-size:18px;line-height:2;text-align:justify}.reading blockquote{margin:2em 0;padding:18px 24px;border-left:3px solid var(--accent);background:var(--accent-soft);color:#514b47}.reading img{max-width:100%;border-radius:12px}.reading code{padding:.15em .4em;border-radius:5px;background:#f0ece8;font-family:ui-monospace,monospace}.hero{padding:110px max(7vw,50px) 80px;background:radial-gradient(circle at 85% 10%,var(--accent-soft),transparent 34%),#fff;border-bottom:1px solid var(--line)}.hero h1{max-width:850px;margin:16px 0 20px;font-size:clamp(42px,6vw,76px);line-height:1.08}.hero p{max-width:680px;color:var(--muted);font-size:18px;line-height:1.8}.start-reading{display:inline-block;margin-top:24px;padding:13px 22px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font:600 14px system-ui,sans-serif}.chapter-section{padding:70px max(5vw,42px) 100px}.section-heading span{color:var(--accent);font:600 11px system-ui,sans-serif;letter-spacing:.2em}.section-heading h2{margin:8px 0 30px;font-size:32px}.chapter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.chapter-card{min-height:160px;padding:24px;border:1px solid var(--line);border-radius:16px;background:#fff;color:inherit;text-decoration:none;transition:.2s}.chapter-card:hover{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 14px 35px rgba(45,33,27,.08)}.chapter-card>span{color:var(--accent);font:600 12px system-ui,sans-serif}.chapter-card h3{margin:18px 0 28px;font-size:19px}.chapter-card em{color:var(--muted);font:normal 12px system-ui,sans-serif}.mobile-header{display:none}@media(prefers-color-scheme:dark){:root{--paper:#191817;--ink:#eee9e4;--muted:#aaa29b;--line:#393532}.book-nav,.hero,.chapter-card{background:#211f1d}.reading code{background:#2d2926}}@media(max-width:840px){.mobile-header{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;padding:14px 18px;background:color-mix(in srgb,var(--paper) 92%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.mobile-header a{color:inherit;text-decoration:none;font-weight:700}.mobile-header button{border:0;background:none;color:var(--accent)}.book-nav{z-index:30;transform:translateX(-102%);transition:.25s;box-shadow:12px 0 40px rgba(0,0,0,.12)}.nav-open .book-nav{transform:none}.book-main{margin-left:0}.reading{padding:54px 24px 90px}.reading h1{font-size:34px}.reading p,.reading li{font-size:17px;line-height:1.9}.hero{padding:70px 24px 60px}.chapter-section{padding:48px 20px 80px}}`;
      const collapseCss = `.nav-toggle{position:absolute;top:24px;right:14px;width:28px;height:28px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--accent);cursor:pointer;font-size:22px;line-height:22px;transition:.2s}.nav-collapsed .book-nav{width:78px;padding-inline:12px}.nav-collapsed .book-main{margin-left:78px}.nav-collapsed .brand{justify-content:center}.nav-collapsed .brand-copy,.nav-collapsed .nav-label,.nav-collapsed .book-nav li a b,.nav-collapsed .book-nav footer{display:none}.nav-collapsed .book-nav li a{justify-content:center;padding:10px 4px}.nav-collapsed .book-nav li a span{font-size:12px}.nav-collapsed .nav-toggle{right:8px;transform:rotate(180deg)}@media(max-width:840px){.nav-toggle{display:none}.nav-collapsed .book-nav{width:var(--nav);padding:32px 22px}.nav-collapsed .book-main{margin-left:0}.nav-collapsed .brand-copy,.nav-collapsed .nav-label,.nav-collapsed .book-nav li a b,.nav-collapsed .book-nav footer{display:block}.nav-collapsed .book-nav li a{justify-content:flex-start;padding:9px 10px}}`;
      const togglePositionCss = `.nav-toggle,.nav-collapsed .nav-toggle{right:-14px;z-index:2}.nav-collapsed .nav-toggle{transform:rotate(180deg)}`;
      for (const directory of [inSite('_data'), inSite('_layouts'), inSite('assets'), inSite('assets/css')]) {
        const created = await window.electronAPI.workspace.createDirectory(target.path, directory);
        if (!created.success && !/EEXIST|ALREADY_EXISTS/.test(String(created.error))) throw new Error(created.error);
      }
      await upsertWorkspaceFile(inSite('_config.yml'), resolvedConfig);
      await upsertWorkspaceFile(inSite('_data/chapters.yml'), `${JSON.stringify(chapterIndex, null, 2)}\n`);
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
      if (!quiet) notice.success({ message: 'GitHub Pages 配置已生成', description: `已收录 ${chapterFiles.length} 章。提交并推送后，请在仓库 Settings → Pages 中选择 GitHub Actions。`, placement: 'bottomRight' });
      setDeploymentStatus({ state: 'configured', message: 'Pages 配置已生成，等待提交和部署', updatedAt: Date.now() });
      persistDeploymentSettings();
      setGitChanges(await getProjectGitChanges(chapterFiles));
      return chapterFiles;
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
      return null;
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
      const initialStatuses: Record<string, ChapterGenerationStatus> = Object.fromEntries(paths.map((path) => [path, chapterStatuses[path] ?? { state: 'pending', updatedAt: Date.now() }]));
      setChapterStatuses(initialStatuses);
      const manifest = JSON.stringify({ schemaVersion: 2, version: 2, name: projectTitle, requirement: bookRequirement, source, chapterBriefs, chapterStatuses: initialStatuses, knowledgeEntries, evidenceRecords, qualityReports, deploymentStatus, splitMode, organizeByPart, template, files: paths, git: { remoteUrl: /^https?:\/\/[^/@]+@/i.test(gitRemoteUrl) ? '' : gitRemoteUrl, remoteName: gitRemoteName, branch: gitBranch }, pages: { title: pagesTitle, description: pagesDescription, author: pagesAuthor, language: pagesLanguage, repositoryName: pagesRepositoryName, customDomain: pagesCustomDomain, accentColor: pagesAccentColor }, updatedAt: Date.now() }, null, 2) + '\n';
      const manifestResult = await window.electronAPI.workspace.mutateFiles(target.path, [{ kind: 'create', path: manifestPath, content: manifest, encoding: 'utf8', lineEnding: 'LF' }]);
      if (!manifestResult.success && String(manifestResult.error).includes('ALREADY_EXISTS')) {
        const updated = await window.electronAPI.workspace.writeTextFile(target.path, manifestPath, manifest, { encoding: 'utf8', lineEnding: 'LF', force: true });
        if (!updated.success) throw new Error(updated.error);
      } else if (!manifestResult.success) throw new Error(manifestResult.error);
      setManagedFiles(paths); setView('documents');
      rememberProject(target, paths, { chapterStatuses: initialStatuses });
      if (paths.length) await openDocument(paths[0], target, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notice.error({ message: '创建失败', description: message.includes('ALREADY_EXISTS') ? '目标中已有同名文件。为保护原内容，本次没有覆盖，请更换子目录名称。' : message, placement: 'bottomRight' });
    } finally { setCreating(false); }
  };

  const activeChapterState = activeFile ? chapterStatuses[activeFile]?.state ?? 'pending' : 'pending';
  const activeQualityReport = activeFile ? qualityReports[activeFile] : undefined;

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    {holder}
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div><h1 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5" />章节文档生成器</h1><p className="mt-1 text-sm text-muted-foreground">描述需求，生成并调整目录，再批量创建 Markdown 文档。</p></div>
      <div className="flex items-center gap-2">{activeProject && <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700" title={activeProject.rootPath}>项目已保存</div>}<Button size="sm" variant={view === 'generator' ? 'default' : 'ghost'} onClick={() => switchView('generator')}>生成器</Button><Button size="sm" variant={view === 'documents' ? 'default' : 'ghost'} onClick={() => switchView('documents')}>文档工作区</Button><Button size="sm" variant={view === 'management' ? 'default' : 'ghost'} disabled={!managedFiles.length} onClick={() => switchView('management')}>全书管理</Button><div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{documents.length} 个文档</div></div>
    </header>
    {view === 'generator' ? <div className="grid min-h-0 flex-1 auto-rows-max content-start grid-cols-1 gap-4 overflow-auto p-6 lg:grid-cols-[minmax(380px,1.15fr)_minmax(300px,.85fr)]">
      <nav aria-label="文档生成进度" className="grid h-fit grid-cols-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-span-2">{['填写需求', '生成目录', '修改确认', '生成文档'].map((step, index) => { const completed = index < generatorStage; const active = index === generatorStage; return <div key={step} aria-current={active ? 'step' : undefined} className={`relative flex min-h-16 items-center justify-center gap-3 px-4 py-3 ${index ? 'border-l border-border' : ''} ${active ? 'bg-primary/[0.08]' : ''}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground'}`}>{completed ? '✓' : index + 1}</span><span className={`text-sm ${active ? 'font-semibold text-primary' : completed ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{step}</span>{active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</div>; })}</nav>
      <section className="flex min-h-[620px] flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div><label className="mb-2 block text-sm font-semibold">第一步：写作需求</label><textarea value={bookRequirement} onChange={(event) => setBookRequirement(event.target.value)} className="h-36 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="说明主题、目标读者、内容范围、时间跨度、预计章数、写作风格和必须覆盖的问题。例如：面向普通读者，系统讲述秦末到汉初的政权更替，约 25 章，兼顾制度、战争与人物选择。" /><Button className="mt-2 w-full" disabled={!bookRequirement.trim() || outlineGenerating} onClick={generateOutlineFromRequirement}>{outlineGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI 生成目录初稿</Button>{outlineError && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{outlineError}</div>}</div>
        <div className="flex min-h-0 flex-1 flex-col"><div className="mb-2 flex items-center justify-between"><label className="text-sm font-semibold">第二步：目录 Markdown</label><div className="flex gap-3"><button type="button" className="text-xs text-primary hover:underline" onClick={() => saveOutlineVersion()}>保存版本</button><button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm('清空当前目录吗？')) { saveOutlineVersion('清空前'); setSource(''); } }}>清空目录</button></div></div><textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} className="min-h-[300px] flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="AI 生成后可继续直接编辑；也支持手动粘贴 Markdown 目录" />{outlineVersions.length > 0 && <div className="mt-2 rounded-md border border-border p-2"><div className="mb-1 text-xs font-medium">目录历史</div><div className="flex gap-2 overflow-x-auto">{outlineVersions.map((version) => <button type="button" key={`${version.createdAt}-${version.label}`} className="shrink-0 rounded bg-muted px-2 py-1 text-xs hover:bg-primary/10 hover:text-primary" title={new Date(version.createdAt).toLocaleString()} onClick={() => { saveOutlineVersion('恢复前'); setSource(version.source); }}>{version.label} · {new Date(version.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</button>)}</div></div>}<p className="mt-2 text-xs text-muted-foreground">目录仅是草稿。可直接编辑文本，也可在右侧目录树逐项修改、排序或删除。</p></div>
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
          <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">第三步：修改并确认目录</h2><p className="mt-1 text-xs text-muted-foreground">悬停条目可修改或删除；删除父级会同时删除其下级。</p></div>{nodes.length > 0 && <Check className="h-4 w-4 text-emerald-500" />}</div>
          {outlineWarnings.length > 0 && <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">{outlineWarnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
          {nodes.length ? <EditableOutlineTree nodes={nodes} onRename={renameOutlineNode} onDelete={deleteOutlineNode} onMove={moveOutlineNode} /> : <p className="text-sm text-muted-foreground">填写需求生成目录，或在左侧手动输入目录。</p>}
          {baseDocuments.length > 0 && <div className="mt-4 border-t border-border pt-3"><button type="button" className="flex w-full items-center justify-between text-left text-sm font-semibold" onClick={() => setShowChapterBriefs((value) => !value)}><span>单章写作卡片 <span className="ml-1 text-xs font-normal text-muted-foreground">{baseDocuments.filter((document) => chapterBriefs[document.path]).length}/{baseDocuments.length}</span></span><span className="text-xs text-muted-foreground">{showChapterBriefs ? '收起' : '展开'}</span></button>{showChapterBriefs && <div className="mt-3 max-h-[460px] space-y-3 overflow-auto pr-1">{baseDocuments.map((document) => { const brief = { ...EMPTY_CHAPTER_BRIEF, ...chapterBriefs[document.path] }; return <div key={document.path} className="rounded-lg border border-border p-3"><div className="mb-2 truncate text-sm font-medium" title={document.title}>{document.title}</div><div className="grid grid-cols-[1fr_90px] gap-2"><input value={brief.goal} onChange={(event) => updateChapterBrief(document.path, { goal: event.target.value })} placeholder="本章写作目标" className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" /><input type="number" min={100} step={100} value={brief.targetWords} onChange={(event) => updateChapterBrief(document.path, { targetWords: Math.max(100, Number(event.target.value) || 2500) })} title="目标字数" className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" /></div><textarea value={brief.keyQuestions} onChange={(event) => updateChapterBrief(document.path, { keyQuestions: event.target.value })} placeholder="核心问题：本章必须回答什么？" className="mt-2 h-14 w-full resize-none rounded-md border border-input bg-background p-2 text-xs" /><textarea value={brief.requiredSources} onChange={(event) => updateChapterBrief(document.path, { requiredSources: event.target.value })} placeholder="必用史料：书名、篇章、论文或材料编号" className="mt-2 h-14 w-full resize-none rounded-md border border-input bg-background p-2 text-xs" /><textarea value={brief.avoidTopics} onChange={(event) => updateChapterBrief(document.path, { avoidTopics: event.target.value })} placeholder="避免重复：哪些内容已由其他章节负责？" className="mt-2 h-14 w-full resize-none rounded-md border border-input bg-background p-2 text-xs" /></div>; })}</div>}</div>}
        </section>
        <Button size="lg" disabled={!target || documents.length === 0 || creating} onClick={generate}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}第四步：生成 {documents.length || 0} 个章节文档</Button>
      </div>
    </div> : view === 'management' ? <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-3">{([['overview', '规划看板'], ['knowledge', '全书知识库'], ['evidence', '史料证据台账'], ['quality', '一致性与门禁'], ['publish', '发布状态']] as const).map(([id, label]) => <Button key={id} size="sm" variant={managementTab === id ? 'default' : 'ghost'} onClick={() => setManagementTab(id)}>{label}</Button>)}<Button size="sm" variant="outline" className="ml-auto" disabled={auditLoading || !target} onClick={runBookAudit}>{auditLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}运行全书检查</Button></div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {managementTab === 'overview' && <div className="mx-auto max-w-7xl space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{[
            ['章节总数', managedFiles.filter((path) => !/README\.md$/i.test(path)).length, 'text-foreground'],
            ['已完成', Object.values(chapterStatuses).filter((item) => item.state === 'complete').length, 'text-emerald-600'],
            ['待确认', Object.values(chapterStatuses).filter((item) => item.state === 'draft').length, 'text-sky-600'],
            ['待审校', Object.values(chapterStatuses).filter((item) => item.state === 'review').length, 'text-amber-600'],
            ['质量阻断', Object.values(qualityReports).filter((item) => item.blockers.length > 0).length, 'text-destructive'],
            ['已核实史料', evidenceRecords.filter((item) => item.status === 'verified').length, 'text-primary'],
          ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-2 text-3xl font-semibold ${color}`}>{value}</div></div>)}</div>
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="font-semibold">章节生产计划</h2><p className="text-xs text-muted-foreground">状态、字数、史料和质量结果集中查看</p></div><span className="text-sm text-muted-foreground">总计 {Object.values(qualityReports).reduce((sum, item) => sum + item.wordCount, 0).toLocaleString()} 字</span></div><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2">章节</th><th className="px-4 py-2">状态</th><th className="px-4 py-2">字数</th><th className="px-4 py-2">史料</th><th className="px-4 py-2">质量</th><th className="px-4 py-2">操作</th></tr></thead><tbody>{managedFiles.filter((path) => !/README\.md$/i.test(path)).map((path) => { const report = qualityReports[path]; const status = chapterStatuses[path]?.state ?? 'pending'; return <tr key={path} className="border-t border-border"><td className="max-w-[420px] truncate px-4 py-3 font-medium" title={path}>{path.split('/').pop()}</td><td className="px-4 py-3">{CHAPTER_STATUS_META[status].label}</td><td className="px-4 py-3">{report?.wordCount ?? '—'}</td><td className="px-4 py-3">{evidenceRecords.filter((item) => item.chapter === path).length}</td><td className="px-4 py-3"><span className={report ? report.blockers.length ? 'text-destructive' : 'text-emerald-600' : 'text-muted-foreground'}>{report ? `${report.score} 分${report.blockers.length ? ` · ${report.blockers.length} 阻断` : ''}` : '未检查'}</span></td><td className="px-4 py-3"><button type="button" className="text-primary hover:underline" onClick={() => { switchView('documents'); void openDocument(path); }}>打开</button></td></tr>; })}</tbody></table></div></section>
        </div>}
        {managementTab === 'knowledge' && <div className="mx-auto max-w-5xl space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">全书知识库</h2><p className="text-sm text-muted-foreground">统一人物、事件、地点、时间和术语的标准写法。</p></div><div className="flex gap-2"><Button variant="outline" disabled={knowledgeLoading || !target} onClick={extractBookKnowledge}>{knowledgeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI 从全书抽取</Button><Button onClick={() => setKnowledgeEntries((current) => [...current, { id: `${Date.now()}`, kind: 'person', name: '', canonical: '', aliases: '', notes: '' }])}>新增条目</Button></div></div>{knowledgeEntries.length ? knowledgeEntries.map((item) => <div key={item.id} className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[120px_1fr_1fr_1.3fr_auto]"><select value={item.kind} onChange={(event) => setKnowledgeEntries((current) => current.map((entry) => entry.id === item.id ? { ...entry, kind: event.target.value as KnowledgeEntry['kind'] } : entry))} className="rounded-md border border-input bg-background px-2 py-2 text-sm"><option value="person">人物</option><option value="event">事件</option><option value="place">地点</option><option value="term">术语</option><option value="date">时间</option></select>{([['name', '条目名称'], ['canonical', '标准写法'], ['aliases', '别名，用顿号分隔']] as const).map(([field, placeholder]) => <input key={field} value={item[field]} placeholder={placeholder} onChange={(event) => setKnowledgeEntries((current) => current.map((entry) => entry.id === item.id ? { ...entry, [field]: event.target.value } : entry))} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />)}<Button size="sm" variant="ghost" onClick={() => setKnowledgeEntries((current) => current.filter((entry) => entry.id !== item.id))}>删除</Button><textarea value={item.notes} placeholder="事实说明、时间范围、人物关系或使用规则" onChange={(event) => setKnowledgeEntries((current) => current.map((entry) => entry.id === item.id ? { ...entry, notes: event.target.value } : entry))} className="h-16 resize-none rounded-md border border-input bg-background p-2 text-sm lg:col-span-5" /></div>) : <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">暂无知识条目。可让 AI 从全书提取，再逐条确认。</div>}</div>}
        {managementTab === 'evidence' && <div className="mx-auto max-w-6xl space-y-4"><div><h2 className="text-lg font-semibold">史料证据台账</h2><p className="text-sm text-muted-foreground">AI 搜集的来源自动进入“线索”，核对原文后再标记为已核实。</p></div><div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2">来源</th><th className="px-4 py-2">关联章节</th><th className="px-4 py-2">状态</th><th className="px-4 py-2">备注</th><th className="px-4 py-2"></th></tr></thead><tbody>{evidenceRecords.map((item) => <tr key={item.id} className="border-t border-border"><td className="max-w-[360px] px-4 py-3"><button type="button" className="block max-w-full truncate text-primary hover:underline" title={item.title} onClick={() => window.electronAPI.shell.openExternal(item.url)}>{item.title}</button><span className="text-xs text-muted-foreground">{item.source}</span></td><td className="max-w-[240px] truncate px-4 py-3" title={item.chapter}>{item.chapter.split('/').pop() || '未关联'}</td><td className="px-4 py-3"><select value={item.status} onChange={(event) => setEvidenceRecords((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as EvidenceRecord['status'] } : entry))} className="rounded border border-input bg-background px-2 py-1"><option value="clue">检索线索</option><option value="verified">已核实</option><option value="disputed">存在争议</option></select></td><td className="px-4 py-3"><input value={item.notes} onChange={(event) => setEvidenceRecords((current) => current.map((entry) => entry.id === item.id ? { ...entry, notes: event.target.value } : entry))} className="w-full rounded border border-input bg-background px-2 py-1" /></td><td className="px-4 py-3"><button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setEvidenceRecords((current) => current.filter((entry) => entry.id !== item.id))}>删除</button></td></tr>)}</tbody></table>{!evidenceRecords.length && <div className="p-12 text-center text-muted-foreground">尚无证据记录。请在章节“助写 → AI 搜集史料”中选择来源。</div>}</div></div>}
        {managementTab === 'quality' && <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">全书一致性检查</h2><p className="text-xs text-muted-foreground">检查跨章重复和知识库标准写法。</p></div><span className="text-sm text-muted-foreground">{consistencyIssues.length} 项</span></div>{consistencyIssues.length ? <div className="max-h-[560px] space-y-2 overflow-auto">{consistencyIssues.map((issue) => <div key={issue} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-800">{issue}</div>)}</div> : <div className="py-16 text-center text-sm text-muted-foreground">运行全书检查后显示结果</div>}</section><section className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="mb-3"><h2 className="font-semibold">章节质量门禁</h2><p className="text-xs text-muted-foreground">占位符、字数不足、待核实和必用史料缺失会阻止完成。</p></div><div className="max-h-[560px] space-y-2 overflow-auto">{Object.entries(qualityReports).map(([path, report]) => <div key={path} className="rounded-md border border-border p-3"><div className="flex items-center justify-between"><span className="truncate text-sm font-medium" title={path}>{path.split('/').pop()}</span><span className={report.blockers.length ? 'text-sm text-destructive' : 'text-sm text-emerald-600'}>{report.score} 分</span></div>{report.blockers.map((item) => <div key={item} className="mt-1 text-xs text-destructive">阻断：{item}</div>)}{report.warnings.map((item) => <div key={item} className="mt-1 text-xs text-amber-700">提示：{item}</div>)}{!report.blockers.length && <Button size="sm" variant="outline" className="mt-2" onClick={() => passQualityGate(path)}>标记为已完成</Button>}</div>)}</div></section></div>}
        {managementTab === 'publish' && <div className="mx-auto max-w-3xl space-y-5"><section className="rounded-xl border border-border bg-card p-6 shadow-sm"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">GitHub Pages 发布状态</h2><p className="mt-1 text-sm text-muted-foreground">读取 GitHub Actions 最近一次 Pages 构建结果。</p></div><span className={`rounded-full px-3 py-1 text-xs ${deploymentStatus.state === 'published' ? 'bg-emerald-500/10 text-emerald-700' : deploymentStatus.state === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{({ unconfigured: '未配置', configured: '等待发布', publishing: '发布中', published: '构建成功', failed: '构建失败' } as const)[deploymentStatus.state]}</span></div><div className="mt-6 grid gap-3 rounded-lg bg-muted/40 p-4 text-sm"><div><span className="text-muted-foreground">远程仓库：</span>{gitRemoteUrl || '未设置'}</div><div><span className="text-muted-foreground">分支：</span>{gitBranch || 'main'}</div><div><span className="text-muted-foreground">最近状态：</span>{deploymentStatus.message || '尚未生成 Pages 配置'}</div>{deploymentStatus.updatedAt > 0 && <div><span className="text-muted-foreground">更新时间：</span>{new Date(deploymentStatus.updatedAt).toLocaleString()}</div>}{deploymentStatus.url && <button type="button" className="w-fit text-primary hover:underline" onClick={() => window.electronAPI.shell.openExternal(deploymentStatus.url!)}>打开发布站点：{deploymentStatus.url}</button>}{pagesRunUrl && <button type="button" className="w-fit text-primary hover:underline" onClick={() => window.electronAPI.shell.openExternal(pagesRunUrl)}>查看 GitHub Actions 构建详情</button>}</div><div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" disabled={!gitRemoteUrl.trim() || deploymentChecking} onClick={refreshPagesDeployment}>{deploymentChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}刷新线上构建状态</Button><Button variant="outline" onClick={() => { switchView('documents'); setGitOpen(true); setPagesOpen(true); }}>打开 Pages 配置</Button><Button onClick={() => { switchView('documents'); setGitOpen(true); }}>打开 Git 发布</Button></div><p className="mt-3 text-xs text-muted-foreground">公开仓库可直接查询；私有仓库需要 GitHub API 鉴权，当前不会读取或上传系统 Git 凭据。</p></section></div>}
      </div>
    </div> : <div className={`grid min-h-0 flex-1 overflow-hidden ${aiOpen || reviewOpen || imageOpen || gitOpen ? 'grid-cols-[280px_minmax(0,1fr)_360px]' : 'grid-cols-[280px_minmax(0,1fr)]'}`}>
      <aside className="flex min-h-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between"><h2 className="truncate text-sm font-semibold">{activeProject?.name || projectTitle || '章节文档'}</h2><span className="text-xs text-muted-foreground">{managedFiles.length}</span></div>{activeProject && <div className="mb-1 text-xs text-emerald-600">● 已保存项目</div>}{target ? <><button type="button" className="w-full truncate text-left text-xs text-muted-foreground hover:text-foreground" title={target.path} onClick={() => loadExistingDocuments()}>{target.path}</button>{!activeProject && managedFiles.length > 0 && <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => rememberProject(target, managedFiles)}>保存为项目</Button>}</> : <Button size="sm" variant="outline" className="w-full" onClick={chooseFolder}>选择目录</Button>}</div>
        {managedFiles.length > 0 && <div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">批量生成队列</span><span className="text-muted-foreground">待写作 {managedFiles.filter((path) => ['pending', 'error'].includes(chapterStatuses[path]?.state ?? 'pending')).length}</span></div>{batchGenerating ? <><div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${batchProgress.total ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0}%` }} /></div><div className="mb-2 truncate text-xs text-muted-foreground">{batchProgress.completed}/{batchProgress.total} · {batchProgress.current || '正在结束'}</div><Button size="sm" variant="outline" className="w-full" onClick={() => { batchStopRef.current = true; }}>完成当前请求后停止</Button></> : <Button size="sm" className="w-full" disabled={!aiApi.apiKey?.trim() || !managedFiles.some((path) => ['pending', 'error'].includes(chapterStatuses[path]?.state ?? 'pending'))} onClick={runBatchGeneration}><Sparkles className="mr-2 h-4 w-4" />生成待写作章节</Button>}</div>}
        <div className="min-h-0 flex-1 overflow-auto p-2">{managedFiles.length ? managedFiles.map((path) => { const status = chapterStatuses[path] ?? { state: 'pending' as const, updatedAt: 0 }; const statusMeta = CHAPTER_STATUS_META[status.state]; return <button type="button" key={path} onClick={() => openDocument(path)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${activeFile === path ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`} title={status.error || statusMeta.label}><FileText className="h-4 w-4 shrink-0" /><span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dot}`} aria-label={statusMeta.label} /><span className="truncate" title={path}>{path.split('/').pop()}</span>{activeFile === path && dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" title="有未保存修改" />}</button>; }) : recentProjects.length ? <div><div className="px-2 py-2 text-xs font-medium text-muted-foreground">历史项目</div>{recentProjects.map((project) => <button type="button" key={project.id} className="mb-1 w-full rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => openSavedProject(project)}><span className="block truncate text-sm font-medium">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{project.files.length} 个文档 · {new Date(project.updatedAt).toLocaleDateString()}</span></button>)}</div> : <div className="p-3 text-sm text-muted-foreground">生成文档或选择目录后，点击“加载已有文档”。</div>}</div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-border px-4"><div className="min-w-0"><span className="block truncate text-sm font-medium">{activeFile || '未选择文档'}</span></div><div className="flex items-center gap-2"><Button size="sm" variant={gitOpen ? 'default' : 'ghost'} disabled={!target} onClick={() => { toggleGit(); setReviewOpen(false); setImageOpen(false); }}> <GitBranch className="mr-2 h-4 w-4" />Git</Button><Button size="sm" variant={aiOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setAiOpen((value) => !value); setReviewOpen(false); setImageOpen(false); setGitOpen(false); }}><Sparkles className="mr-2 h-4 w-4" />助写</Button><Button size="sm" variant={reviewOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setReviewOpen((value) => !value); setAiOpen(false); setImageOpen(false); setGitOpen(false); setAiResult(''); setAiError(''); }}><Check className="mr-2 h-4 w-4" />审校</Button><Button size="sm" variant={imageOpen ? 'default' : 'ghost'} disabled={!activeFile} onClick={() => { setImageOpen((value) => !value); setAiOpen(false); setReviewOpen(false); setGitOpen(false); setImageError(''); }}><Sparkles className="mr-2 h-4 w-4" />插图</Button><Button size="sm" variant={editorMode === 'edit' ? 'secondary' : 'ghost'} onClick={() => setEditorMode('edit')}>编辑</Button><Button size="sm" variant={editorMode === 'preview' ? 'secondary' : 'ghost'} onClick={() => setEditorMode('preview')}>预览</Button><Button size="sm" disabled={!dirty || saving || !activeFile} onClick={saveDocument}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}保存</Button></div></div>
        {activeFile && <>
          <div className="flex items-center gap-3 border-b border-border bg-primary/[0.04] px-4 py-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CHAPTER_STATUS_META[activeChapterState].dot}`} />
            <div className="min-w-0 flex-1"><div className="text-xs font-semibold">{CHAPTER_STATUS_META[activeChapterState].label}</div><div className="truncate text-xs text-muted-foreground">{activeChapterState === 'pending' || activeChapterState === 'error' ? '使用助写生成正文，或直接编辑后保存。' : activeChapterState === 'draft' ? '阅读草稿并保存修改，确认后进入独立审校。' : activeChapterState === 'review' ? '运行审校，逐条决定哪些意见需要落实。' : activeChapterState === 'revising' ? '应用已采纳意见，确认修改后进入质量检查。' : activeChapterState === 'quality' ? '运行检查后在这里处理具体问题；通过后自动完成。' : activeChapterState === 'complete' ? '本章已完成；继续编辑会保留完成状态。' : '正在生成正文。'}</div></div>
            {(activeChapterState === 'pending' || activeChapterState === 'error') && <Button size="sm" onClick={() => { setAiMode('generate'); setAiOpen(true); setReviewOpen(false); setImageOpen(false); setGitOpen(false); }}>生成本章</Button>}
            {activeChapterState === 'draft' && <Button size="sm" disabled={dirty} onClick={confirmCurrentDraft}>确认草稿并审校</Button>}
            {activeChapterState === 'review' && <Button size="sm" onClick={() => { setReviewOpen(true); setAiOpen(false); setImageOpen(false); setGitOpen(false); }}>开始审校</Button>}
            {activeChapterState === 'revising' && (dirty ? <Button size="sm" disabled={saving} onClick={saveDocument}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存修改</Button> : <Button size="sm" onClick={enterQualityCheck}>进入质量检查</Button>)}
            {activeChapterState === 'quality' && <Button size="sm" disabled={dirty} onClick={() => passQualityGate(activeFile)}>{dirty ? '请先保存' : activeQualityReport?.blockers.length ? '重新检查' : '运行质量检查'}</Button>}
          </div>
          {activeChapterState === 'quality' && activeQualityReport && !dirty && <div className={`border-b px-4 py-3 ${activeQualityReport.blockers.length ? 'border-destructive/30 bg-destructive/[0.06]' : 'border-emerald-500/30 bg-emerald-500/[0.06]'}`}>
            <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className={`text-xs font-semibold ${activeQualityReport.blockers.length ? 'text-destructive' : 'text-emerald-700'}`}>{activeQualityReport.blockers.length ? `需要处理 ${activeQualityReport.blockers.length} 项` : '质量检查已通过'}</div>{activeQualityReport.blockers.map((item) => <div key={item} className="mt-1 text-xs text-destructive">• {item}</div>)}{activeQualityReport.warnings.map((item) => <div key={item} className="mt-1 text-xs text-amber-700">提示：{item}</div>)}</div>{activeQualityReport.blockers.some((item) => item.includes('待核实') || item.includes('占位符')) && <Button size="sm" variant="outline" onClick={locateFirstQualityIssue}>定位正文标记</Button>}</div>
          </div>}
        </>}
        {editorMode === 'edit' && activeFile && evidenceRecords.length > 0 && <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2"><span className="shrink-0 text-xs text-muted-foreground">证据绑定</span><select value={selectedEvidenceId} onChange={(event) => setSelectedEvidenceId(event.target.value)} className="min-w-0 max-w-sm flex-1 rounded border border-input bg-background px-2 py-1 text-xs"><option value="">选择史料</option>{evidenceRecords.map((item) => <option key={item.id} value={item.id}>{item.status === 'verified' ? '✓ ' : ''}{item.title}</option>)}</select><Button size="sm" variant="outline" disabled={!selectedEvidenceId} onMouseDown={(event) => event.preventDefault()} onClick={bindEvidenceToSelection}>绑定到选中文字</Button><span className="truncate text-xs text-muted-foreground">先在正文中选择一个完整观点或句子</span></div>}
        <div className="min-h-0 flex-1 overflow-auto">{documentLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : !activeFile ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个文档</div> : editorMode === 'edit' ? <textarea ref={editorRef} value={documentContent} onChange={(event) => setDocumentContent(event.target.value)} spellCheck={false} className="h-full min-h-[500px] w-full resize-none border-0 bg-background p-6 font-mono text-sm leading-7 outline-none" /> : <article className="prose prose-sm mx-auto max-w-4xl p-8 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{documentContent}</ReactMarkdown></article>}</div>
        {activeFile && <div className="flex h-8 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground"><span>{dirty ? '有未保存的修改' : '所有修改已保存'}</span><span title="字数已排除 YAML 头信息、Markdown 标记、链接地址和注释">文章 {articleWordCount.toLocaleString()} 字 · 原始 {documentContent.length.toLocaleString()} 字符</span></div>}
      </main>
      {aiOpen && <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-4"><div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />AI 章节助写</div><p className="mt-1 text-xs text-muted-foreground">当前模型：{aiApi.model || '未配置'}</p></div>
        <div className="max-h-[52vh] space-y-3 overflow-auto border-b border-border p-4">
          <label className="block text-xs text-muted-foreground">写作任务<select value={aiMode} onChange={(event) => setAiMode(event.target.value as typeof aiMode)} disabled={aiLoading} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"><option value="generate">生成本章正文</option><option value="continue">续写本章</option><option value="revise">按要求修改文章</option><option value="polish">润色全文</option></select></label>
          <label className="block text-xs text-muted-foreground">{aiMode === 'revise' ? '具体修改要求' : '补充要求与可靠资料'}<textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} disabled={aiLoading} placeholder={aiMode === 'revise' ? '例如：删除第三节重复内容；核正某个日期；扩写制度背景 300 字；其余段落保持不变' : '例如：目标约 2500 字；核心史实、参考资料、必须解释的争议，以及希望采用的叙事视角'} className="mt-1 h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm text-foreground" /></label>
          <label className="block text-xs text-muted-foreground">史料与参考资料<textarea value={aiSources} onChange={(event) => setAiSources(event.target.value)} disabled={aiLoading} placeholder="粘贴史书原文、考古材料、论文摘要、可靠网页摘录或自己整理的史实。建议同时注明书名、作者、篇章或链接。" className="mt-1 h-32 w-full resize-none rounded-md border border-input bg-background p-2 text-sm text-foreground" /></label>
          <p className="text-xs text-muted-foreground">精确引文只从这里取用；未提供出处的内容不会伪造卷次、页码或原话。</p>
          {aiMode === 'generate' && <div className="space-y-2 rounded-md border border-border p-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">第一阶段：研究提纲与证据映射</span><span className="text-[10px] text-muted-foreground">{researchPlans[activeFile]?.trim() ? '已生成，可编辑' : '尚未生成'}</span></div><Button type="button" variant="outline" size="sm" className="w-full" disabled={researchPlanLoading || aiLoading || !aiApi.apiKey?.trim()} onClick={generateResearchPlan}>{researchPlanLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成研究提纲</Button>{researchPlans[activeFile] !== undefined && <textarea value={researchPlans[activeFile]} onChange={(event) => setResearchPlans((current) => ({ ...current, [activeFile]: event.target.value }))} disabled={researchPlanLoading || aiLoading} className="h-52 w-full resize-y rounded-md border border-input bg-background p-2 text-xs leading-5 text-foreground" aria-label="研究提纲与证据映射" />}<p className="text-xs text-muted-foreground">确认核心问题、材料性质、争议和结论边界后，再生成正文。</p></div>}
          <Button type="button" variant="outline" className="w-full" disabled={sourceResearchLoading || !activeFile} onClick={researchHistoricalSources}>{sourceResearchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI 搜集史料</Button>
          {sourceResearchQueries.length > 0 && <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"><div className="mb-1 font-medium text-foreground">检索计划</div>{sourceResearchQueries.map((query) => <div key={query} className="truncate" title={query}>• {query}</div>)}</div>}
          {sourceResearchError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{sourceResearchError}</div>}
          {sourceResearchResults.length > 0 && <div className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center justify-between"><span className="text-xs font-medium">史料来源候选</span><button type="button" className="text-xs text-primary hover:underline" onClick={() => setSourceResearchResults((current) => current.map((item) => ({ ...item, selected: true })))}>全选</button></div>
            <div className="max-h-56 space-y-2 overflow-auto">{sourceResearchResults.map((item) => <label key={item.id} className="flex cursor-pointer gap-2 rounded-md border border-border p-2 hover:bg-muted/50"><input type="checkbox" checked={item.selected} onChange={(event) => setSourceResearchResults((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked } : candidate))} className="mt-1" /><span className="min-w-0"><span className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.title}>{item.title}</span><span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{item.source}</span></span><span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.snippet || '无搜索摘要'}</span><button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={(event) => { event.preventDefault(); event.stopPropagation(); window.electronAPI.shell.openExternal(item.url); }}>打开原文 · {item.domain}</button></span></label>)}</div>
            <Button type="button" size="sm" className="w-full" disabled={!sourceResearchResults.some((item) => item.selected)} onClick={addSelectedResearchSources}>加入选中的史料线索</Button>
            <p className="text-xs text-amber-700">搜索摘要不是史料原文。请打开来源核对作者、日期和上下文后再引用。</p>
          </div>}
          {!aiApi.apiKey?.trim() && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">尚未配置 API Key，请先前往应用设置配置 AI。</div>}
          {aiLoading ? <Button variant="outline" className="w-full" onClick={stopAi}>停止生成</Button> : <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={!aiApi.apiKey?.trim()} onClick={() => runAi(false)}><Sparkles className="mr-1 h-4 w-4" />生成预览</Button><Button disabled={!aiApi.apiKey?.trim()} onClick={() => runAi(true)}>生成并写入</Button></div>}
          {aiError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{aiError}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{aiResult ? <article className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown>{aiLoading && <span className="inline-block h-4 w-1 animate-pulse bg-primary" />}</article> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">选择任务并填写要求，<br />AI 结果将在这里预览。</div>}</div>
        <div className={`grid gap-2 border-t border-border p-3 ${aiMode === 'continue' ? 'grid-cols-1' : 'grid-cols-2'}`}><Button variant="outline" disabled={!aiResult || aiLoading} onClick={() => applyAiResult('append')}>{aiMode === 'continue' ? '追加续写内容' : '追加到文档'}</Button>{aiMode !== 'continue' && <Button disabled={!aiResult || aiLoading} onClick={() => applyAiResult('replace')}>替换文档</Button>}</div>
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
        <div className="min-h-0 flex-1 overflow-auto p-4">{reviewSuggestions.length > 0 && <div className="mb-4 space-y-2"><div className="flex items-center justify-between text-xs font-semibold"><span>逐条处理审校意见</span><span className="text-muted-foreground">已采纳 {reviewSuggestions.filter((item) => item.decision === 'accepted').length}</span></div>{reviewSuggestions.map((item) => <div key={item.id} className={`rounded-md border p-2 text-xs ${item.decision === 'accepted' ? 'border-emerald-500/40 bg-emerald-500/10' : item.decision === 'rejected' ? 'border-border bg-muted/40 opacity-60' : 'border-border'}`}><div className="font-medium">{item.section} · {item.position}</div>{item.issue && <div className="mt-1 text-muted-foreground">{item.issue}</div>}{item.suggestion && <div className="mt-1">建议：{item.suggestion}</div>}<div className="mt-2 flex gap-2"><button type="button" className="text-emerald-700 hover:underline" onClick={() => setReviewSuggestions((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, decision: 'accepted' } : candidate))}>采纳</button><button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setReviewSuggestions((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, decision: 'rejected' } : candidate))}>拒绝</button><button type="button" className="text-muted-foreground hover:underline" onClick={() => setReviewSuggestions((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, decision: 'pending' } : candidate))}>待定</button></div></div>)}</div>}{reviewPatches.length > 0 && <div className="mb-4 space-y-3 border-t border-border pt-4"><div className="text-xs font-semibold">段落级修改预览</div>{reviewPatches.map((patch) => <div key={patch.id} className="overflow-hidden rounded-md border border-border text-xs"><div className="bg-destructive/10 p-2"><div className="mb-1 font-semibold text-destructive">− 原段落</div><div className="whitespace-pre-wrap line-through decoration-destructive/50">{patch.original}</div></div><div className="border-t border-border bg-emerald-500/10 p-2"><div className="mb-1 font-semibold text-emerald-700">+ 修改后</div><div className="whitespace-pre-wrap">{patch.replacement}</div></div><div className="flex items-center justify-between border-t border-border p-2"><span className="text-muted-foreground">{patch.state === 'conflict' ? '原文已变化，无法安全应用' : patch.state === 'applied' ? '已应用，可撤销' : '等待应用'}</span><Button size="sm" variant={patch.state === 'applied' ? 'outline' : 'default'} disabled={patch.state === 'conflict'} onClick={() => toggleReviewPatch(patch)}>{patch.state === 'applied' ? '撤销' : '应用此段'}</Button></div></div>)}</div>}{aiResult ? <article className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown></article> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">AI 将列出明确错误、待核实内容、<br />扩写方向和修改优先级。</div>}</div>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3"><Button variant="outline" disabled={!aiResult || aiLoading} onClick={() => { window.electronAPI.copyText(aiResult); notice.success({ message: '审校报告已复制', placement: 'bottomRight' }); }}>复制报告</Button><Button disabled={!reviewSuggestions.some((item) => item.decision === 'accepted') || reviewPatchLoading} onClick={generateReviewPatches}>{reviewPatchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}生成段落 Diff</Button><Button variant="outline" className="col-span-2" disabled={!aiResult || !reviewSuggestions.some((item) => item.decision === 'accepted') || aiLoading || reviewPatchLoading} onClick={applyReviewReport}>{reviewPatchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}高级：按已采纳意见修改全文</Button><p className="col-span-2 text-xs text-muted-foreground">推荐逐段应用 Diff；全文修改范围更大，执行前会再次确认。</p></div>
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
        <div className="max-h-[58vh] space-y-3 overflow-auto border-b border-border p-4"><label className="block text-xs text-muted-foreground">提交说明<input value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /></label>{gitRepository === false && <Button className="w-full" disabled={gitLoading} onClick={initializeGit}><GitBranch className="mr-2 h-4 w-4" />初始化为 Git 仓库</Button>}<div className="flex gap-2"><Button variant="outline" className="flex-1" disabled={gitLoading} onClick={refreshGit}>{gitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}刷新状态</Button><Button className="flex-1" disabled={gitLoading || gitRepository !== true || !gitChanges.length || !gitMessage.trim()} onClick={commitToGit}>本地提交 {gitChanges.length}</Button></div><div className="border-t border-border pt-3"><div className="mb-2 text-xs font-medium">推送到新的远程仓库</div><input value={gitRemoteUrl} onChange={(event) => setGitRemoteUrl(event.target.value)} placeholder="https://github.com/user/repo.git 或 git@..." className="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /><div className="grid grid-cols-2 gap-2"><input value={gitRemoteName} onChange={(event) => setGitRemoteName(event.target.value)} placeholder="origin" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /><input value={gitBranch} onChange={(event) => setGitBranch(event.target.value)} placeholder="main" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" /></div><Button className="mt-2 w-full" disabled={gitLoading || !gitRemoteUrl.trim() || !gitRemoteName.trim() || !gitBranch.trim()} onClick={() => void publishToRemote()}>提交并推送到远程仓库</Button><p className="mt-2 text-xs text-muted-foreground">HTTPS 凭据由 Git Credential Manager 管理；SSH 地址使用系统 SSH Key。</p></div><div className="border-t border-border pt-3"><button type="button" className="flex w-full items-center justify-between text-left text-xs font-medium" onClick={() => setPagesOpen((value) => !value)}><span>GitHub Pages 配置</span><span>{pagesOpen ? '收起' : '展开'}</span></button>{pagesOpen && <div className="mt-3 space-y-2"><input value={pagesTitle} onChange={(event) => setPagesTitle(event.target.value)} placeholder="站点标题" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><textarea value={pagesDescription} onChange={(event) => setPagesDescription(event.target.value)} placeholder="站点描述（用于首页与 SEO）" className="h-16 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" /><div className="grid grid-cols-2 gap-2"><input value={pagesAuthor} onChange={(event) => setPagesAuthor(event.target.value)} placeholder="作者" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><input value={pagesLanguage} onChange={(event) => setPagesLanguage(event.target.value)} placeholder="zh-CN" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div><input value={pagesRepositoryName} onChange={(event) => setPagesRepositoryName(event.target.value)} placeholder="仓库名（项目站点需要，例如 my-book）" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><input value={pagesCustomDomain} onChange={(event) => setPagesCustomDomain(event.target.value)} placeholder="自定义域名（可选，例如 book.example.com）" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /><Button className="w-full" disabled={gitLoading || !managedFiles.length} onClick={configureGitHubPages}>生成 GitHub Pages 配置</Button><p className="text-xs text-muted-foreground">主题：Minima；包含 SEO、RSS、404、章节首页和自动部署 workflow。</p>{pagesCustomDomain.trim() && <p className="text-xs text-amber-700">自定义域名仍需在 GitHub 仓库 Settings → Pages 中配置并完成 DNS 验证。</p>}</div>}</div>{gitError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{gitError}</div>}</div>
        {gateFixTargets.length > 0 && <div className="space-y-2 border-b border-border p-3"><div className="text-xs font-medium">发现 {gateFixTargets.length} 章质量提示</div><div className="max-h-24 overflow-auto text-xs text-muted-foreground">{publishGateIssues.slice(0, 5).map((item) => <div key={item} className="truncate" title={item}>• {item}</div>)}</div><div className="grid grid-cols-2 gap-2"><Button disabled={gitLoading} onClick={() => void openAiGateFix()}><Sparkles className="mr-2 h-4 w-4" />处理问题</Button><Button variant="outline" disabled={gitLoading || !publishCanOverride} onClick={() => { if (window.confirm(`仍有 ${gateFixTargets.length} 章未通过质量检查。确认忽略这些提示并提交吗？`)) void publishToRemote(true); }}>忽略并提交</Button></div><p className="text-xs text-muted-foreground">质量提示可跳过；未保存、文件缺失或无法读取等错误仍会阻止提交。</p></div>}
        <div className="min-h-0 flex-1 overflow-auto p-3">{gitChanges.length ? gitChanges.map((change) => <div key={change.path} className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted"><span className="w-6 shrink-0 font-mono text-primary">{change.status.trim() || 'M'}</span><span className="truncate" title={change.path}>{change.path}</span></div>) : !gitLoading && !gitError ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">文章目录没有待提交的改动</div> : null}</div>
      </aside>}
    </div>}
  </div>;
};
