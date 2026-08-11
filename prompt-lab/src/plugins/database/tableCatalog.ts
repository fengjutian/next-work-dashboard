export type TableCategoryId = 'agents' | 'conversations' | 'ai' | 'documents' | 'weread' | 'hanyu' | 'zodiac' | 'prompts' | 'plugins' | 'system' | 'other';

export type TableCategory = { id: TableCategoryId; label: string; description: string };

export const TABLE_CATEGORIES: TableCategory[] = [
  { id: 'agents', label: '智能体任务', description: '会话、任务、消息与修改提案' },
  { id: 'conversations', label: 'AI 对话', description: '聊天会话、消息与注入记录' },
  { id: 'ai', label: 'AI 缓存', description: '模型响应、向量与语义缓存' },
  { id: 'documents', label: '文档知识库', description: '已解析文档、片段与查看状态' },
  { id: 'weread', label: '微信读书', description: '书籍、笔记、复习与同步数据' },
  { id: 'hanyu', label: '汉语新解', description: '生成结果与失败记录' },
  { id: 'zodiac', label: '十二星座视角', description: '十二星座视角运行记录与追问消息' },
  { id: 'prompts', label: '提示词与技能', description: '提示词、技能及关联文件' },
  { id: 'plugins', label: '站点与插件', description: '站点和插件运行数据' },
  { id: 'system', label: '系统配置', description: '设置和数据库版本' },
  { id: 'other', label: '其他数据', description: '尚未归类的业务表' },
];

const TABLE_LABELS: Record<string, string> = {
  agent_logs: '智能体日志', agent_messages: '智能体消息', agent_proposals: '修改提案', agent_sessions: '智能体会话', agent_tasks: '智能体任务',
  chat_messages: '对话消息', chat_sessions: '对话会话', inject_history: '提示注入历史',
  embedding_cache: '向量缓存', llm_cache_events: '模型缓存事件', llm_response_cache: '模型响应缓存', semantic_shadow_cache: '语义影子缓存',
  weread_actions: '阅读行动', weread_books: '书籍缓存', weread_export_state: '导出状态', weread_notes: '结构化笔记', weread_notes_fts: '笔记全文索引', weread_review_state: '复习状态', weread_sync_history: '同步历史',
  hanyu_jinjie_executions: '汉语新解执行记录',
  zodiac_runs: '十二星座运行记录',
  zodiac_followup_messages: '十二星座追问消息',
  document_knowledge_records: '文档知识记录',
  prompts: '提示词', skills: '技能', skill_files: '技能文件',
  sites: '站点配置', settings: '应用设置', schema_version: '数据库版本',
};

export function tableDisplayName(table: string): string { return TABLE_LABELS[table] || table; }

export function tableCategoryId(table: string): TableCategoryId {
  if (table.startsWith('agent_')) return 'agents';
  if (table.startsWith('chat_') || table === 'inject_history') return 'conversations';
  if (table.includes('cache') || table.startsWith('embedding_') || table.startsWith('semantic_') || table.startsWith('llm_')) return 'ai';
  if (table.startsWith('document_knowledge_')) return 'documents';
  if (table.startsWith('weread_')) return 'weread';
  if (table.startsWith('hanyu_jinjie_')) return 'hanyu';
  if (table.startsWith('zodiac_')) return 'zodiac';
  if (table === 'prompts' || table === 'skills' || table === 'skill_files') return 'prompts';
  if (table === 'sites' || table.startsWith('plugin_')) return 'plugins';
  if (table === 'settings' || table === 'schema_version') return 'system';
  return 'other';
}
