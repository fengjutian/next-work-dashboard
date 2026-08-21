import type { ChapterWorkflowState } from "./outline";

export const CHAPTER_STATUS_META: Record<ChapterWorkflowState, { label: string; dot: string }> = {
  pending: { label: "待写作", dot: "bg-slate-400" }, generating: { label: "生成中", dot: "bg-primary animate-pulse" }, draft: { label: "草稿待确认", dot: "bg-sky-500" }, review: { label: "待审校", dot: "bg-amber-500" }, revising: { label: "修改待确认", dot: "bg-orange-500" }, quality: { label: "待质量检查", dot: "bg-violet-500" }, complete: { label: "已完成", dot: "bg-emerald-500" }, error: { label: "生成失败", dot: "bg-destructive" },
};

export type BatchPromptPresetId = "general" | "psychology" | "history" | "custom";
export const BATCH_PROMPT_PRESETS: Record<Exclude<BatchPromptPresetId, "custom">, { label: string; prompt: string }> = {
  general: { label: "通用非虚构", prompt: "你是非虚构图书作者兼事实编辑。围绕当前章节标题和写作简报展开，只使用与本章直接相关的材料，不引入其他项目或无关历史案例。" },
  psychology: { label: "心理 / 成长", prompt: "你是心理与个人成长类图书作者。使用清晰的心理机制、可观察行为和贴近日常的案例展开；不做临床诊断，不虚构研究，不自行引入朝代、帝王或战争案例。" },
  history: { label: "历史写作", prompt: "你是历史类图书作者兼事实编辑。区分同时代材料、后世记载与现代研究，说明证据边界，不把推测写成史实。" },
};

export const EMPTY_CHAPTER_BRIEF = { goal: "", targetWords: 2500, keyQuestions: "", requiredSources: "", avoidTopics: "" };
export type EditorialStageId = "completeness" | "structure" | "facts" | "professional" | "language" | "citations" | "consistency" | "format";
export const EDITORIAL_STAGES: Array<{ id: EditorialStageId; label: string; scope: "chapter" | "book" }> = [
  { id: "completeness", label: "内容完整性校验", scope: "chapter" }, { id: "structure", label: "结构逻辑校验", scope: "chapter" }, { id: "facts", label: "事实准确性校验", scope: "chapter" }, { id: "professional", label: "专业/技术校验", scope: "chapter" }, { id: "language", label: "语言文字校验", scope: "chapter" }, { id: "citations", label: "引用来源校验", scope: "chapter" }, { id: "consistency", label: "全书一致性校验", scope: "book" }, { id: "format", label: "出版格式校验", scope: "book" },
];
export const EDITORIAL_AI_FOCUS: Record<Exclude<EditorialStageId, "consistency" | "format">, string> = {
  completeness: "核对章节写作目标、核心问题、小节任务和必用材料是否得到实质回答；指出缺失、只有结论没有展开、越界写入其他章节的内容。",
  structure: "检查每节是否有明确问题，段落是否形成观点—证据—分析，时间线、因果链、对比与转折是否完整；指出重复、跳跃、倒置和机械总结。",
  facts: "逐条检查日期、数字、人物行动、制度范围、引语、群体态度、首次或唯一等强结论；区分史料记载、现代解释和作者推断，不凭模型记忆宣布已核实。",
  professional: "按历史类专业编辑标准检查纪年、官职、地名、制度沿革、时代语境、现代分析概念、目的论和后世材料误作同时代事实。",
  language: "检查错别字、病句、指代、重复、套话、AI腔、句式单调和空泛升华，同时保护准确的专业表达，不为追求文采改变事实强度。",
  citations: "检查重要主张是否有对应来源，来源能否支持结论强度，引文是否需要原文核对，搜索摘要是否被误作证据，书目信息是否完整。",
};
