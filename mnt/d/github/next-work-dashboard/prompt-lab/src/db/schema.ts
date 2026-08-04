import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ── Schema version tracking ──
export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
  description: text('description').notNull().default(''),
});

// ── Agent sessions ──
export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'), // active | archived | completed
  instruction: text('instruction').notNull().default(''),
  worktreePath: text('worktree_path'),
  worktreeBranch: text('worktree_branch'),
  worktreeHead: text('worktree_head'),
  worktreeDirty: integer('worktree_dirty').notNull().default(0),
  isPinned: integer('is_pinned').notNull().default(0),
  parentSessionId: text('parent_session_id'),
  tokenBudget: integer('token_budget'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'),
});

// ── Agent chat messages per session ──
export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  seq: integer('seq').notNull().default(0),
  timestamp: integer('timestamp').notNull(),
});

// ── Agent log entries per session ──
export const agentLogs = sqliteTable('agent_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  level: text('level').notNull().default('info'), // info | success | error | warning
  message: text('message').notNull(),
  seq: integer('seq').notNull().default(0),
  timestamp: integer('timestamp').notNull(),
});

// ── Agent file proposals per session ──
export const agentProposals = sqliteTable('agent_proposals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  original: text('original').notNull().default(''),
  modified: text('modified').notNull().default(''),
  language: text('language').notNull().default(''),
  previousPath: text('previous_path'),
  accepted: integer('accepted'),
  acceptedAt: integer('accepted_at'),
  seq: integer('seq').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// ── Agent task records (for restart recovery) ──
export const agentTasks = sqliteTable('agent_tasks', {
  taskId: text('task_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  workspaceRoot: text('workspace_root').notNull().default(''),
  executionRoot: text('execution_root'),
  instruction: text('instruction').notNull().default(''),
  modelConfig: text('model_config').notNull().default('{}'), // JSON
  multiFile: integer('multi_file').notNull().default(0),
  tokenBudget: integer('token_budget').notNull().default(32000),
  state: text('state').notNull().default('queued'),
  error: text('error'),
  recovery: text('recovery'), // JSON: { checkpoint, contextPaths }
  result: text('result'), // JSON: { proposals, rawResponse }
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  updatedAt: integer('updated_at').notNull(),
});
