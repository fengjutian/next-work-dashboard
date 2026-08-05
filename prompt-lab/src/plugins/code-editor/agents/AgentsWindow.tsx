import React, { useState } from 'react';
import { XMarkdown } from '@ant-design/x-markdown';
import { Bot, ChevronDown, Copy, Edit3, PanelLeft, PanelRight, Pin, Plus, Search, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { AiFileProposal } from '../hooks/useAiSessionState';
import type { AgentLogEntry, AgentSession } from './agent-sessions';
import type { AiExecutionMetrics, AiExecutionStage } from '../hooks/useAiEditGeneration';
import type { AgentEditScope } from './agent-edit-scope';
import { summarizeAiProposal } from './ai-proposal-summary';
import type { WorkspaceTask } from '@/types/electron';

interface AgentsWindowProps {
  workspace: { path: string; name: string } | null;
  sessions: AgentSession[];
  archivedSessions: AgentSession[];
  activeSession: AgentSession | null;
  activeLogs: AgentLogEntry[];
  aiInstruction: string;
  aiEditing: boolean;
  aiPendingRequest: { instruction: string; status: 'running' | 'interrupted' } | null;
  aiExecutionStage: AiExecutionStage;
  aiExecutionMetrics: AiExecutionMetrics | null;
  aiReasoningText: string;
  aiMode: "analyze" | "modify";
  onModeChange: (mode: "analyze" | "modify") => void;
  aiMultiFile: boolean;
  aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>;
  aiProposals: AiFileProposal[];
  activeDocumentPath?: string;
  agentScope: AgentEditScope;
  onAgentScopeChange: (kind: AgentEditScope['kind']) => void;
  workspaceTasks: WorkspaceTask[];
  validationRun: { name: string; state: 'running' | 'background' | 'completed' | 'failed' | 'cancelled' } | null;
  onClose: () => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onRestoreSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onClearLogs: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onForkSession: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onMultiFileChange: (value: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenProposal: (proposal: AiFileProposal) => void;
  onAcceptProposal: (path: string) => void;
  onRejectProposal: (path: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onRunValidation: (taskNames: string[]) => void;
  onCancelValidation: () => void;
  onValidationConfigChange: (taskNames: string[], autoValidate: boolean) => void;
  onFixValidationFailure: () => void;
  aiTokenBudget: number;
  onTokenBudgetChange: (value: number) => void;
  taskQueueCount: number;
  taskRunningCount: number;
  worktreeBusy: boolean;
  onCreateWorktree: () => void;
  onRefreshWorktree: () => void;
  onMergeWorktree: () => void;
  onDeliverWorktree: () => void;
  onDiscardWorktree: () => void;
}

const statusLabel: Record<AgentSession['status'], string> = {
  idle: '待命', running: '运行中', review: '待审阅', completed: '已完成', interrupted: '已中断',
};

const stageLabel: Record<AiExecutionStage, string> = {
  idle: '等待任务',
  'collecting-context': '正在收集工作区上下文',
  summarizing: '正在压缩历史会话',
  generating: '模型正在生成修改',
  parsing: '正在解析和校验结果',
  review: '修改已生成，等待审阅',
  cancelling: '正在取消请求',
  interrupted: '请求已中断，可重新运行',
  failed: '请求失败，请检查状态信息',
};

export const AgentsWindow: React.FC<AgentsWindowProps> = (props) => {
  const [sessionView, setSessionView] = useState<'active' | 'archived'>('active');
  const [contentView, setContentView] = useState<'conversation' | 'logs'>('conversation');
  const [sessionQuery, setSessionQuery] = useState('');
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  if (!props.workspace) return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Bot className="h-14 w-14 opacity-40" />
      <p className="text-sm font-medium text-foreground">Agents 需要工作区</p>
      <p className="text-xs">请先退出 Agents 视图并打开一个文件夹。</p>
      <Button size="sm" variant="outline" onClick={props.onClose}>返回编辑器</Button>
    </div>
  );
  const normalizedQuery = sessionQuery.trim().toLocaleLowerCase();
  const displayedSessions = normalizedQuery ? props.sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery)) : props.sessions;
  const displayedArchivedSessions = normalizedQuery ? props.archivedSessions.filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery)) : props.archivedSessions;

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className={`flex shrink-0 flex-col overflow-hidden border-r transition-[width] duration-300 ease-in-out ${sessionsOpen ? 'w-60' : 'w-10'}`}>
        <div className={`flex h-10 shrink-0 items-center border-b transition-all duration-300 ${sessionsOpen ? 'gap-2 px-3' : 'justify-center px-1'}`}>
          {sessionsOpen && <><Bot className="h-4 w-4 shrink-0" /><span className="whitespace-nowrap text-xs font-semibold">AGENT SESSIONS</span><div className="flex-1" /><button title="新建会话" className="rounded p-1 hover:bg-accent" onClick={props.onCreateSession}><Plus className="h-4 w-4" /></button></>}
          <button type="button" title={sessionsOpen ? '折叠会话列表' : '展开会话列表'} aria-label={sessionsOpen ? '折叠会话列表' : '展开会话列表'} aria-expanded={sessionsOpen} className="rounded p-1 transition-colors duration-200 hover:bg-accent" onClick={() => setSessionsOpen((open) => !open)}><PanelLeft className={`h-4 w-4 transition-transform duration-300 ${sessionsOpen ? '' : 'rotate-180'}`} /></button>
        </div>
        <div aria-hidden={!sessionsOpen} className={`flex min-h-0 w-60 flex-1 flex-col transition-opacity duration-200 ${sessionsOpen ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0'}`}>
        <div className="border-b px-2 py-1.5">
          <div className="mb-1 px-1 text-[10px] text-muted-foreground">{props.workspace.name}</div>
          <div className="relative mb-1"><Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" /><input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder="搜索会话" className="h-6 w-full rounded border bg-background pl-6 pr-2 text-[10px] outline-none" /></div>
          <div className="grid grid-cols-2 rounded bg-muted/40 p-0.5 text-[10px]">
            <button className={`rounded px-2 py-1 ${sessionView === 'active' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setSessionView('active')}>进行中 {props.sessions.length}</button>
            <button className={`rounded px-2 py-1 ${sessionView === 'archived' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} disabled={props.aiEditing} onClick={() => setSessionView('archived')}>已归档 {props.archivedSessions.length}</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {sessionView === 'active' && displayedSessions.length === 0 && (sessionQuery ? <p className="p-4 text-center text-xs text-muted-foreground">没有匹配的会话</p> : <button className="w-full rounded border border-dashed p-4 text-xs text-muted-foreground hover:bg-accent" onClick={props.onCreateSession}>创建第一个 Agent 会话</button>)}
          {sessionView === 'active' && displayedSessions.map((session) => (
            <button key={session.id} disabled={props.aiEditing && props.activeSession?.id !== session.id} className={`group mb-1 w-full rounded px-2 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${props.activeSession?.id === session.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`} onClick={() => props.onSelectSession(session.id)}>
              <div className="flex items-center gap-1">{session.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-primary" />}<span className="min-w-0 flex-1 truncate font-medium">{session.title}</span><span className="text-[9px] text-muted-foreground">{statusLabel[session.status]}</span></div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground"><span>{session.filesChanged} 文件</span><span>已接受 {session.accepted}</span><span>{new Date(session.updatedAt).toLocaleTimeString()}</span></div>
            </button>
          ))}
          {sessionView === 'archived' && displayedArchivedSessions.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">{sessionQuery ? '没有匹配的会话' : '暂无已归档会话'}</p>}
          {sessionView === 'archived' && displayedArchivedSessions.map((session) => <div key={session.id} className="mb-1 rounded border px-2 py-2 text-xs">
            <div className="truncate font-medium">{session.title}</div>
            <div className="mt-1 text-[9px] text-muted-foreground">归档于 {new Date(session.archivedAt ?? session.updatedAt).toLocaleString()}</div>
            <div className="mt-2 flex justify-end gap-1"><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { props.onRestoreSession(session.id); setSessionView('active'); }}>恢复</Button><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive" onClick={() => props.onDeleteSession(session.id)}>永久删除</Button></div>
          </div>)}
        </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 items-center gap-2 border-b px-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.activeSession?.title ?? '选择或创建会话'}</span>
          <div className="flex rounded bg-muted/40 p-0.5 text-[10px]"><button className={`rounded px-2 py-1 ${contentView === 'conversation' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setContentView('conversation')}>对话</button><button className={`rounded px-2 py-1 ${contentView === 'logs' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setContentView('logs')}>日志 {props.activeLogs.length}</button></div>
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => props.activeSession && props.onRenameSession(props.activeSession.id)}><Edit3 className="mr-1 h-3 w-3" />重命名</Button>}
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={props.aiEditing} onClick={() => props.activeSession && props.onTogglePin(props.activeSession.id, !props.activeSession.pinned)}><Pin className="mr-1 h-3 w-3" />{props.activeSession.pinned ? '取消置顶' : '置顶'}</Button>}
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={props.aiEditing} onClick={() => props.activeSession && props.onForkSession(props.activeSession.id)}><Copy className="mr-1 h-3 w-3" />分叉</Button>}
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={props.aiEditing} onClick={() => props.activeSession && props.onArchiveSession(props.activeSession.id)}>归档</Button>}
          <button title="关闭 Agents" className="rounded p-1 hover:bg-accent" onClick={props.onClose}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {contentView === 'logs' ? <div className="mx-auto max-w-4xl font-mono text-[11px]">
            <div className="mb-3 flex justify-end gap-1"><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={props.activeLogs.length === 0} onClick={() => void navigator.clipboard.writeText(props.activeLogs.map((entry) => `${new Date(entry.timestamp).toLocaleString()} [${entry.level.toUpperCase()}] ${entry.message}`).join('\n'))}><Copy className="mr-1 h-3 w-3" />复制日志</Button><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!props.activeSession || props.activeLogs.length === 0 || props.aiEditing} onClick={() => props.activeSession && props.onClearLogs(props.activeSession.id)}>清空</Button></div>
            {props.activeLogs.length === 0 ? <p className="py-10 text-center text-muted-foreground">当前会话暂无日志</p> : props.activeLogs.map((entry) => <div key={entry.id} className="grid grid-cols-[80px_58px_1fr] gap-2 border-b py-1.5"><span className="text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span><span className={entry.level === 'error' ? 'text-destructive' : entry.level === 'warning' ? 'text-warning' : entry.level === 'success' ? 'text-success' : 'text-muted-foreground'}>{entry.level.toUpperCase()}</span><span className="whitespace-pre-wrap break-words">{entry.message}</span></div>)}
          </div> : !props.activeSession ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground">新建会话后开始任务</div> : props.aiMessages.length === 0
            ? <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><Bot className="h-10 w-10 opacity-40" /><p className="text-sm text-foreground">Agent 已准备好</p><p className="text-xs">描述要完成的代码任务，结果会先进入 Diff 审阅。</p></div>
            : props.aiMessages.map((message, index) => <div key={`${message.timestamp}-${index}`} className={`mb-3 max-w-3xl rounded-lg border p-3 text-xs ${message.role === 'user' ? 'ml-auto bg-primary/5' : 'mr-auto bg-muted/30'}`}><div className="mb-1 text-[10px] font-semibold text-muted-foreground">{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '系统'}</div>{message.role === 'user' ? <div className="whitespace-pre-wrap">{message.content}</div> : <XMarkdown content={message.content} className="text-xs" />}</div>)}
        </div>
        {contentView === 'conversation' && <div className="border-t p-3">
          {props.aiMode === 'analyze' && props.aiEditing && props.aiReasoningText && <div className="mb-2 overflow-hidden rounded border bg-muted/20 text-xs transition-colors duration-200 hover:border-primary/30">
            <button type="button" aria-expanded={reasoningOpen} className="flex w-full items-center gap-2 px-2 py-2 text-left font-medium transition-colors duration-200 hover:bg-accent/40" onClick={() => setReasoningOpen((open) => !open)}>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-out ${reasoningOpen ? 'rotate-0' : '-rotate-90'}`} />
              <span className="flex-1">公开分析过程</span>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            </button>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${reasoningOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="max-h-[40vh] overflow-auto border-t px-3 py-2">
                  <XMarkdown content={props.aiReasoningText} streaming={{ hasNextChunk: true }} className="text-xs" />
                </div>
              </div>
            </div>
          </div>}
          {(props.aiEditing || props.aiExecutionStage !== 'idle') && <div className="mb-2 flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${props.aiEditing ? 'animate-pulse bg-primary' : props.aiExecutionStage === 'failed' || props.aiExecutionStage === 'interrupted' ? 'bg-warning' : 'bg-success'}`} /><span>{stageLabel[props.aiExecutionStage]}</span>{props.aiExecutionMetrics && <><span>· {props.aiExecutionMetrics.receivedChars.toLocaleString()} 字符</span>{props.aiExecutionMetrics.firstChunkAt && <span>· 首字节 {props.aiExecutionMetrics.firstChunkAt - props.aiExecutionMetrics.startedAt}ms</span>}<span>· {(((props.aiExecutionMetrics.endedAt ?? Date.now()) - props.aiExecutionMetrics.startedAt) / 1000).toFixed(1)}s</span></>}</div>}
          <textarea value={props.aiInstruction} disabled={!props.activeSession || props.aiEditing} onChange={(event) => props.onInstructionChange(event.target.value)} placeholder="描述一个代码任务…" className="min-h-24 w-full resize-none rounded-md border bg-background p-3 text-xs outline-none" />
          <div className="mt-2 flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2"><button className={"rounded px-2 py-0.5 text-[10px] " + (props.aiMode === "analyze" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent")} disabled={props.aiEditing} onClick={() => props.onModeChange("analyze")}>分析</button><button className={"rounded px-2 py-0.5 text-[10px] " + (props.aiMode === "modify" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent")} disabled={props.aiEditing} onClick={() => props.onModeChange("modify")}>修改</button></div>
            <div className="flex rounded bg-muted/40 p-0.5 text-[10px]">{([['workspace', '工作区'], ['directory', '选中目录'], ['files', '选中文件']] as const).map(([kind, label]) => <button key={kind} disabled={props.aiEditing} className={`rounded px-2 py-1 ${props.agentScope.kind === kind ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => props.onAgentScopeChange(kind)}>{label}</button>)}</div>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={props.aiMultiFile} onChange={(event) => props.onMultiFileChange(event.target.checked)} />多文件</label>
            <span className="truncate text-muted-foreground" title={props.agentScope.paths.join(', ')}>范围：{props.agentScope.label}</span>
            <div className="flex-1" />
            {props.aiEditing
              ? <Button size="sm" variant="destructive" onClick={props.onCancel}>取消运行</Button>
              : <Button size="sm" disabled={!props.activeSession || (props.agentScope.kind !== 'workspace' && props.agentScope.paths.length === 0) || (props.agentScope.kind === 'workspace' && !props.activeDocumentPath && !props.aiMultiFile && props.aiMode === 'modify') || !props.aiInstruction.trim()} onClick={props.onGenerate}>{props.aiPendingRequest?.status === 'interrupted' ? '重新运行' : '运行 Agent'}</Button>}
          </div>
        </div>}
      </section>

      <aside className={`flex shrink-0 flex-col overflow-hidden border-l transition-[width] duration-300 ease-in-out ${changesOpen ? 'w-72' : 'w-10'}`}>
        <div className={`flex h-10 shrink-0 items-center border-b text-xs font-semibold transition-all duration-300 ${changesOpen ? 'px-3' : 'justify-center px-1'}`}>
          {changesOpen && <>CHANGES <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">{props.aiProposals.length}</span><div className="flex-1" />{props.aiProposals.length > 0 && <><button className="rounded px-1.5 py-1 text-[10px] font-normal text-primary hover:bg-accent" onClick={props.onAcceptAll}>{props.activeSession?.worktree ? '写入 worktree' : '全部接受'}</button><button className="rounded px-1.5 py-1 text-[10px] font-normal text-destructive hover:bg-accent" onClick={props.onRejectAll}>全部拒绝</button></>}</>}
          <button type="button" title={changesOpen ? '折叠右侧面板' : '展开右侧面板'} aria-label={changesOpen ? '折叠右侧面板' : '展开右侧面板'} aria-expanded={changesOpen} className="rounded p-1 transition-colors duration-200 hover:bg-accent" onClick={() => setChangesOpen((open) => !open)}><PanelRight className={`h-4 w-4 transition-transform duration-300 ${changesOpen ? '' : 'rotate-180'}`} /></button>
        </div>
        <div aria-hidden={!changesOpen} className={`flex min-h-0 w-72 flex-1 flex-col transition-opacity duration-200 ${changesOpen ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0'}`}>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {props.aiProposals.length === 0 && <p className="p-3 text-xs text-muted-foreground">Agent 生成修改后会显示在这里。</p>}
          {props.aiProposals.map((proposal) => {
            const summary = summarizeAiProposal(proposal);
            const kindLabel = { create: '新增', modify: '修改', delete: '删除', rename: '重命名' }[summary.kind];
            return <div key={proposal.path} className="mb-1 rounded border px-2 py-2 text-xs hover:bg-accent/40"><button className="w-full text-left" onClick={() => props.onOpenProposal(proposal)}><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{proposal.path.split(/[\\/]/).pop()}</span><span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{kindLabel}</span></div><div className="mt-1 truncate text-[10px] text-muted-foreground">{proposal.previousPath ? `${proposal.previousPath} → ${proposal.path}` : proposal.path}</div><div className="mt-1 text-[10px]"><span className="text-success">+{summary.additions}</span> <span className="text-destructive">-{summary.deletions}</span></div></button><div className="mt-1 flex justify-end gap-1">{!props.activeSession?.worktree && <button className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-accent" onClick={() => props.onAcceptProposal(proposal.path)}>接受</button>}<button className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-accent" onClick={() => props.onRejectProposal(proposal.path)}>拒绝</button></div></div>;
          })}
        </div>
        <div className="border-t p-3">
          <div className="mb-2 text-[10px] font-semibold">VALIDATION</div>
          {props.workspaceTasks.length === 0 ? <p className="text-[10px] text-muted-foreground">未发现工作区任务</p> : (() => {
            const selected = props.activeSession?.validationTasks ?? (props.activeSession?.validationTask ? [props.activeSession.validationTask] : []);
            const running = Boolean(props.validationRun && (props.validationRun.state === 'running' || props.validationRun.state === 'background'));
            return <><div className="max-h-24 overflow-auto rounded border p-1">{props.workspaceTasks.map((task) => <label key={task.name} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent"><input type="checkbox" checked={selected.includes(task.name)} disabled={!props.activeSession || running} onChange={(event) => props.onValidationConfigChange(event.target.checked ? [...selected, task.name] : selected.filter((name) => name !== task.name), Boolean(props.activeSession?.autoValidate))} /><span className="truncate">{task.name}</span></label>)}</div><div className="mt-2 flex gap-1">{running ? <Button size="sm" variant="destructive" className="h-7 flex-1 px-2 text-[10px]" onClick={props.onCancelValidation}>取消流水线</Button> : <Button size="sm" variant="outline" className="h-7 flex-1 px-2 text-[10px]" disabled={!props.activeSession || selected.length === 0} onClick={() => props.onRunValidation(selected)}>运行 {selected.length} 项</Button>}<Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" disabled={!props.activeLogs.some((entry) => entry.level === 'error' && entry.message.startsWith('验证失败'))} onClick={() => { props.onFixValidationFailure(); setContentView('conversation'); }}>修复失败</Button></div><label className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground"><input type="checkbox" checked={Boolean(props.activeSession?.autoValidate)} disabled={!props.activeSession || selected.length === 0} onChange={(event) => props.onValidationConfigChange(selected, event.target.checked)} />接受修改后自动运行流水线</label></>;
          })()}
          {props.validationRun && <div className="mt-2 text-[10px] text-muted-foreground">{props.validationRun.name} · {props.validationRun.state}</div>}
        </div>
        <div className="border-t p-3">
          <div className="mb-2 text-[10px] font-semibold">TOKEN BUDGET</div>
          <div className="space-y-1 text-[10px]">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: Math.min(100, (props.aiExecutionMetrics ? props.aiExecutionMetrics.receivedChars / props.aiTokenBudget * 100 : 0)) + "%", backgroundColor: (props.aiExecutionMetrics && props.aiExecutionMetrics.receivedChars > props.aiTokenBudget * 0.8) ? "var(--warning)" : "var(--primary)" }} />
              </div>
              <span className="text-muted-foreground">{props.aiTokenBudget.toLocaleString()} tokens</span>
            </div>
            <div className="flex items-center gap-1">
              <input type="range" min={4000} max={64000} step={1000} value={props.aiTokenBudget} disabled={props.aiEditing} onChange={(e) => props.onTokenBudgetChange(Number(e.target.value))} className="flex-1 h-1" />
              <span className="w-14 text-right text-muted-foreground">{props.aiTokenBudget >= 1000 ? (props.aiTokenBudget / 1000).toFixed(0) + "k" : props.aiTokenBudget}</span>
            </div>
          </div>
        </div>
        <div className="border-t p-3">
          <div className="mb-2 text-[10px] font-semibold">QUEUE</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>排队 {props.taskQueueCount} · 运行中 {props.taskRunningCount}</span>
            <div className="flex-1" />
            <span className="text-success">并发上限 2</span>
          </div>
        </div>
        <div className="border-t p-3">
          <div className="mb-2 text-[10px] font-semibold">ISOLATION</div>
          {props.activeSession?.worktree ? <div className="space-y-1 text-[10px]"><div className="truncate text-muted-foreground" title={props.activeSession.worktree.path}>{props.activeSession.worktree.branch}</div><div className="flex items-center gap-2"><span className={props.activeSession.worktree.dirty ? 'text-warning' : 'text-success'}>{props.activeSession.worktree.dirty ? '有未提交修改' : '工作区干净'}</span><div className="flex-1" /><button className="rounded px-1 py-0.5 hover:bg-accent" disabled={props.worktreeBusy} onClick={props.onRefreshWorktree}>刷新</button><button className="rounded px-1 py-0.5 text-primary hover:bg-accent" disabled={props.worktreeBusy || props.aiEditing} onClick={props.onMergeWorktree}>合并</button><button className="rounded px-1 py-0.5 text-primary hover:bg-accent" disabled={props.worktreeBusy || props.aiEditing} onClick={props.onDeliverWorktree}>创建 PR</button><button className="rounded px-1 py-0.5 text-destructive hover:bg-accent" disabled={props.worktreeBusy || props.aiEditing} onClick={props.onDiscardWorktree}>放弃</button></div><p className="text-success">AI 读取、候选写入和验证均在隔离 worktree 执行。</p></div> : <Button size="sm" variant="outline" className="h-7 w-full text-[10px]" disabled={!props.activeSession || props.worktreeBusy || props.aiEditing} onClick={props.onCreateWorktree}>{props.worktreeBusy ? '准备中…' : '准备独立 worktree'}</Button>}
        </div>
        <div className="border-t p-3 text-[10px] text-muted-foreground">{props.activeSession?.worktree ? '隔离模式：审阅后原子写入 worktree，不修改主工作区。' : '所有修改都需要通过 Diff 审阅，不会自动保存。'}</div>
        </div>
      </aside>
    </div>
  );
};
