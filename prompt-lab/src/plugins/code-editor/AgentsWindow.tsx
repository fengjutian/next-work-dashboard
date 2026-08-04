import React, { useState } from 'react';
import { Bot, Edit3, Plus, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { AiFileProposal } from './useAiSessionState';
import type { AgentSession } from './agent-sessions';
import type { AiExecutionStage } from './useAiEditGeneration';

interface AgentsWindowProps {
  workspace: { path: string; name: string } | null;
  sessions: AgentSession[];
  archivedSessions: AgentSession[];
  activeSession: AgentSession | null;
  aiInstruction: string;
  aiEditing: boolean;
  aiPendingRequest: { instruction: string; status: 'running' | 'interrupted' } | null;
  aiExecutionStage: AiExecutionStage;
  aiMultiFile: boolean;
  aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>;
  aiProposals: AiFileProposal[];
  activeDocumentPath?: string;
  onClose: () => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onRestoreSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onMultiFileChange: (value: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenProposal: (proposal: AiFileProposal) => void;
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
  if (!props.workspace) return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Bot className="h-14 w-14 opacity-40" />
      <p className="text-sm font-medium text-foreground">Agents 需要工作区</p>
      <p className="text-xs">请先退出 Agents 视图并打开一个文件夹。</p>
      <Button size="sm" variant="outline" onClick={props.onClose}>返回编辑器</Button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <Bot className="h-4 w-4" /><span className="text-xs font-semibold">AGENT SESSIONS</span>
          <div className="flex-1" />
          <button title="新建会话" className="rounded p-1 hover:bg-accent" onClick={props.onCreateSession}><Plus className="h-4 w-4" /></button>
        </div>
        <div className="border-b px-2 py-1.5">
          <div className="mb-1 px-1 text-[10px] text-muted-foreground">{props.workspace.name}</div>
          <div className="grid grid-cols-2 rounded bg-muted/40 p-0.5 text-[10px]">
            <button className={`rounded px-2 py-1 ${sessionView === 'active' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setSessionView('active')}>进行中 {props.sessions.length}</button>
            <button className={`rounded px-2 py-1 ${sessionView === 'archived' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} disabled={props.aiEditing} onClick={() => setSessionView('archived')}>已归档 {props.archivedSessions.length}</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {sessionView === 'active' && props.sessions.length === 0 && <button className="w-full rounded border border-dashed p-4 text-xs text-muted-foreground hover:bg-accent" onClick={props.onCreateSession}>创建第一个 Agent 会话</button>}
          {sessionView === 'active' && props.sessions.map((session) => (
            <button key={session.id} disabled={props.aiEditing && props.activeSession?.id !== session.id} className={`group mb-1 w-full rounded px-2 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${props.activeSession?.id === session.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`} onClick={() => props.onSelectSession(session.id)}>
              <div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate font-medium">{session.title}</span><span className="text-[9px] text-muted-foreground">{statusLabel[session.status]}</span></div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground"><span>{session.filesChanged} 文件</span><span>已接受 {session.accepted}</span><span>{new Date(session.updatedAt).toLocaleTimeString()}</span></div>
            </button>
          ))}
          {sessionView === 'archived' && props.archivedSessions.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">暂无已归档会话</p>}
          {sessionView === 'archived' && props.archivedSessions.map((session) => <div key={session.id} className="mb-1 rounded border px-2 py-2 text-xs">
            <div className="truncate font-medium">{session.title}</div>
            <div className="mt-1 text-[9px] text-muted-foreground">归档于 {new Date(session.archivedAt ?? session.updatedAt).toLocaleString()}</div>
            <div className="mt-2 flex justify-end gap-1"><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { props.onRestoreSession(session.id); setSessionView('active'); }}>恢复</Button><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive" onClick={() => props.onDeleteSession(session.id)}>永久删除</Button></div>
          </div>)}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 items-center gap-2 border-b px-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.activeSession?.title ?? '选择或创建会话'}</span>
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => props.activeSession && props.onRenameSession(props.activeSession.id)}><Edit3 className="mr-1 h-3 w-3" />重命名</Button>}
          {props.activeSession && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={props.aiEditing} onClick={() => props.activeSession && props.onArchiveSession(props.activeSession.id)}>归档</Button>}
          <button title="关闭 Agents" className="rounded p-1 hover:bg-accent" onClick={props.onClose}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!props.activeSession ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground">新建会话后开始任务</div> : props.aiMessages.length === 0
            ? <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><Bot className="h-10 w-10 opacity-40" /><p className="text-sm text-foreground">Agent 已准备好</p><p className="text-xs">描述要完成的代码任务，结果会先进入 Diff 审阅。</p></div>
            : props.aiMessages.map((message, index) => <div key={`${message.timestamp}-${index}`} className={`mb-3 max-w-3xl rounded-lg border p-3 text-xs ${message.role === 'user' ? 'ml-auto bg-primary/5' : 'mr-auto bg-muted/30'}`}><div className="mb-1 text-[10px] font-semibold text-muted-foreground">{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '系统'}</div><div className="whitespace-pre-wrap">{message.content}</div></div>)}
        </div>
        <div className="border-t p-3">
          {(props.aiEditing || props.aiExecutionStage !== 'idle') && <div className="mb-2 flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${props.aiEditing ? 'animate-pulse bg-primary' : props.aiExecutionStage === 'failed' || props.aiExecutionStage === 'interrupted' ? 'bg-warning' : 'bg-success'}`} /><span>{stageLabel[props.aiExecutionStage]}</span></div>}
          <textarea value={props.aiInstruction} disabled={!props.activeSession || props.aiEditing} onChange={(event) => props.onInstructionChange(event.target.value)} placeholder="描述一个代码任务…" className="min-h-24 w-full resize-none rounded-md border bg-background p-3 text-xs outline-none" />
          <div className="mt-2 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={props.aiMultiFile} onChange={(event) => props.onMultiFileChange(event.target.checked)} />多文件 Agent</label>
            <span className="truncate text-muted-foreground">{props.activeDocumentPath ? `当前文件：${props.activeDocumentPath}` : '未打开文件'}</span>
            <div className="flex-1" />
            {props.aiEditing
              ? <Button size="sm" variant="destructive" onClick={props.onCancel}>取消运行</Button>
              : <Button size="sm" disabled={!props.activeSession || !props.activeDocumentPath || !props.aiInstruction.trim()} onClick={props.onGenerate}>{props.aiPendingRequest?.status === 'interrupted' ? '重新运行' : '运行 Agent'}</Button>}
          </div>
        </div>
      </section>

      <aside className="flex w-72 shrink-0 flex-col border-l">
        <div className="flex h-10 items-center border-b px-3 text-xs font-semibold">CHANGES <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">{props.aiProposals.length}</span></div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {props.aiProposals.length === 0 && <p className="p-3 text-xs text-muted-foreground">Agent 生成修改后会显示在这里。</p>}
          {props.aiProposals.map((proposal) => <button key={proposal.path} className="mb-1 w-full rounded border px-2 py-2 text-left text-xs hover:bg-accent" onClick={() => props.onOpenProposal(proposal)}><div className="truncate font-medium">{proposal.path.split(/[\\/]/).pop()}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{proposal.path}</div></button>)}
        </div>
        <div className="border-t p-3 text-[10px] text-muted-foreground">所有修改都需要通过 Diff 审阅，不会自动保存。</div>
      </aside>
    </div>
  );
};
