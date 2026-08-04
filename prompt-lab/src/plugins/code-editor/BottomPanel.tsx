import React from 'react';
import { Button } from '@/components/ui/button';
import { TerminalSingle } from '@/plugins/terminal/Terminal';
import type { TerminalTab, TerminalProfile } from '@/plugins/terminal/Terminal';
import { Code, X } from '@/components/icons';
import type { BottomPanelTab, EditorPreferences, EditorProblem, EditorSymbol } from './editor-types';
import type { WorkspaceGitCommit, WorkspaceGitOverview, WorkspaceGitStatus, WorkspaceTask } from '@/types/electron';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { classifyConflictStatus } from '../../main/git-conflicts';
import { GitHistoryGraph } from './GitHistoryGraph';

interface EditorTerminalTab extends TerminalTab { profile?: TerminalProfile }

export interface BottomPanelProps {
  bottomPanel: { open: boolean; tab: BottomPanelTab; height: number };
  setBottomPanel: React.Dispatch<React.SetStateAction<{ open: boolean; tab: BottomPanelTab; height: number }>>;
  // terminal
  terminalTabs: EditorTerminalTab[];
  setTerminalTabs: React.Dispatch<React.SetStateAction<EditorTerminalTab[]>>;
  activeTerminalId: string;
  setActiveTerminalId: React.Dispatch<React.SetStateAction<string>>;
  splitTerminalId: string | null;
  setSplitTerminalId: React.Dispatch<React.SetStateAction<string | null>>;
  terminalProfileName: string;
  setTerminalProfileName: React.Dispatch<React.SetStateAction<string>>;
  terminalProfiles: TerminalProfile[];
  addTerminalProfile: () => Promise<void>;
  saveTerminalSecret: () => Promise<void>;
  workspaceTasks: WorkspaceTask[];
  taskRun: { runId: string; name: string; state: 'running' | 'background' | 'completed' | 'failed' | 'cancelled'; startedAt: number } | null;
  taskHistory: Array<{ runId: string; name: string; state: 'completed' | 'failed' | 'cancelled'; startedAt: number; endedAt: number }>;
  cancelWorkspaceTask: () => void;
  renamingTerminalId: string | null;
  renamingTerminalTitle: string;
  setRenamingTerminalId: React.Dispatch<React.SetStateAction<string | null>>;
  setRenamingTerminalTitle: React.Dispatch<React.SetStateAction<string>>;
  createTerminalTab: (split?: boolean) => void;
  closeTerminalTab: (id: string) => void;
  restartTerminalTab: (id: string) => void;
  runWorkspaceTask: (taskName: string) => void;
  handleTerminalOutput: (id: string, data: string) => void;
  appendOutput: (msg: string) => void;
  workspacePath?: string;
  resolvedTheme: string;
  // problems
  allProblems: EditorProblem[];
  documents: Array<{ path: string }>;
  pendingRevealRef: React.MutableRefObject<{ path: string; line: number; column: number } | null>;
  setActivePath: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setAiInstruction: React.Dispatch<React.SetStateAction<string>>;
  // outline
  symbols: EditorSymbol[];
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  // output
  outputLines: string[];
  // source control
  gitOverview: WorkspaceGitOverview | null;
  gitBusy: { operation: string; operationId: string } | null;
  pullStrategy: 'ff-only' | 'merge' | 'rebase';
  setPullStrategy: React.Dispatch<React.SetStateAction<'ff-only' | 'merge' | 'rebase'>>;
  runGitOperation: (op: string, payload?: Record<string, unknown>) => Promise<boolean>;
  appPrompt: (title: string, defaultValue?: string) => Promise<string | null>;
  appConfirm: (msg: string) => Promise<boolean>;
  cancelGitOp: () => void;
  gitView: 'changes' | 'history' | 'stash';
  setGitView: React.Dispatch<React.SetStateAction<'changes' | 'history' | 'stash'>>;
  gitStatus: WorkspaceGitStatus[];
  gitHistory: WorkspaceGitCommit[];
  loadGitHistory: (filters: { query?: string; author?: string; since?: string; until?: string }, append?: boolean) => Promise<void>;
  compareGitCommits: (from: string, to: string) => Promise<void>;
  commitMessage: string;
  setCommitMessage: React.Dispatch<React.SetStateAction<string>>;
  commitGitChanges: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  refreshGitOverview: () => Promise<void>;
  showGitDiff: (entry: WorkspaceGitStatus) => Promise<void>;
  updateGitStage: (entry: WorkspaceGitStatus, stage: boolean) => Promise<void>;
  setDiffView: React.Dispatch<React.SetStateAction<{
    path: string; name: string; original: string; modified: string;
    language: string; source?: 'external' | 'git' | 'merge' | 'ai' | 'search';
  } | null>>;
  // ai
  aiMultiFile: boolean;
  setAiMultiFile: React.Dispatch<React.SetStateAction<boolean>>;
  aiProposals: Array<{ path: string }>;
  aiHistory: Array<{ id: number; path: string }>;
  aiSessions: Array<{ id: number; instruction: string; filesChanged: number; timestamp: number }>;
  aiTokenBudget: number;
  setAiTokenBudget: React.Dispatch<React.SetStateAction<number>>;
  aiEstimatedTokens: number;
  aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>;
  aiPendingRequest: { instruction: string; status: 'running' | 'interrupted' } | null;
  undoLastAiEdit: () => void;
  aiInstruction: string;
  aiEditing: boolean;
  activeDocument: { path?: string } | null;
  generateAiEdit: () => Promise<void>;
  cancelAiEdit: () => void;
  // settings
  preferences: EditorPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<EditorPreferences>>;
  showEnvValues: boolean;
  setShowEnvValues: React.Dispatch<React.SetStateAction<boolean>>;
  terminalEnvText: string;
  setTerminalEnvText: React.Dispatch<React.SetStateAction<string>>;
}

export const BottomPanel: React.FC<BottomPanelProps> = (props) => {
  const { bottomPanel, setBottomPanel } = props;
  if (!bottomPanel.open) return null;

  return (
    <section className="relative flex shrink-0 flex-col border-t bg-background" style={{ height: bottomPanel.height }}>
      <div className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize"
        onMouseDown={(event) => {
          const startY = event.clientY;
          const startHeight = bottomPanel.height;
          const move = (e: MouseEvent) => setBottomPanel((p) => ({ ...p, height: Math.max(120, Math.min(520, startHeight + startY - e.clientY)) }));
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        }} />
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-[11px]">
        {([
          ['problems', `问题 (${props.allProblems.length})`],
          ['output', '输出'], ['terminal', '终端'],
          ['outline', `大纲 (${props.symbols.length})`],
          ['sourceControl', `源代码管理 (${props.gitStatus.length})`],
          ['ai', 'AI 修改'], ['settings', '设置'],
        ] as Array<[BottomPanelTab, string]>).map(([tab, label]) => (
          <button key={tab} className={`h-full border-b-2 px-2 ${bottomPanel.tab === tab ? 'border-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setBottomPanel((p) => ({ ...p, tab }))}>{label}</button>
        ))}
        <div className="flex-1" />
        <button className="rounded p-1 hover:bg-accent" onClick={() => setBottomPanel((p) => ({ ...p, open: false }))}><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {bottomPanel.tab === 'terminal' && <TerminalTabContent {...props} />}
        {bottomPanel.tab === 'problems' && <ProblemsTabContent {...props} />}
        {bottomPanel.tab === 'outline' && <OutlineTabContent {...props} />}
        {bottomPanel.tab === 'output' && <pre className="min-h-full whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">{props.outputLines.join('\n')}</pre>}
        {bottomPanel.tab === 'sourceControl' && <SourceControlTabContent {...props} />}
        {bottomPanel.tab === 'ai' && <AiTabContent {...props} />}
        {bottomPanel.tab === 'settings' && <SettingsTabContent {...props} />}
      </div>
    </section>
  );
};

// --- Sub-components ---

const TerminalTabContent: React.FC<BottomPanelProps> = (p) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-8 shrink-0 items-center border-b bg-muted/30 px-1">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {p.terminalTabs.map((tab) => (
          <button key={tab.id} draggable className={`group flex h-7 max-w-44 items-center gap-1.5 rounded px-2 text-xs ${tab.id === p.activeTerminalId ? 'bg-background' : 'text-muted-foreground hover:bg-accent'}`}
            onClick={() => p.setActiveTerminalId(tab.id)}
            onDoubleClick={() => { p.setRenamingTerminalId(tab.id); p.setRenamingTerminalTitle(tab.title); }}>
            <span className={tab.alive ? 'text-success' : 'text-destructive'}>●</span>
            {p.renamingTerminalId === tab.id
              ? <input autoFocus value={p.renamingTerminalTitle} onChange={(e) => p.setRenamingTerminalTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { p.setTerminalTabs((prev) => prev.map((t) => t.id === tab.id ? { ...t, title: p.renamingTerminalTitle } : t)); p.setRenamingTerminalId(null); } if (e.key === 'Escape') p.setRenamingTerminalId(null); }} onBlur={() => p.setRenamingTerminalId(null)} className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-[10px] outline-none" onClick={(e) => e.stopPropagation()} />
              : <span className="truncate">{tab.title}</span>}
            <span role="button" className="rounded px-1 opacity-0 hover:bg-accent group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); p.closeTerminalTab(tab.id); }}>×</span>
          </button>
        ))}
      </div>
      <select value={p.terminalProfileName} onChange={(e) => p.setTerminalProfileName(e.target.value)} className="h-7 max-w-28 rounded border bg-background px-1 text-[10px]">{p.terminalProfiles.map((pr) => <option key={pr.name}>{pr.name}</option>)}</select>
      <select defaultValue="" onChange={(e) => { if (e.target.value) p.runWorkspaceTask(e.target.value); e.target.value = ''; }} className="h-7 max-w-44 rounded border bg-background px-1 text-[10px]"><option value="">运行任务…</option>{p.workspaceTasks.map((t) => <option key={t.name} value={t.name}>{t.name}{t.dependsOn.length ? ` ← ${t.dependsOn.length}` : ''}{t.isBackground ? ' • 后台' : ''}</option>)}</select>
      {p.taskRun && <span className="text-[10px] text-muted-foreground">{p.taskRun.name}: {p.taskRun.state}</span>}
      {p.taskRun && (p.taskRun.state === 'running' || p.taskRun.state === 'background') && <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-destructive" onClick={p.cancelWorkspaceTask}>取消任务</Button>}
      {p.taskHistory.length > 0 && <span className="text-[10px] text-muted-foreground" title={p.taskHistory.slice(-5).map((item) => `${item.name}: ${item.state}`).join('\n')}>历史 {p.taskHistory.length}</span>}
      <button className="rounded px-2 py-1 text-sm hover:bg-accent" onClick={() => p.createTerminalTab(false)}>＋</button>
      <button className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => p.createTerminalTab(true)}>拆分</button>
      {p.splitTerminalId && <button className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => p.setSplitTerminalId(null)}>关闭分屏</button>}
      {!p.terminalTabs.find((t) => t.id === p.activeTerminalId)?.alive && <button className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => p.restartTerminalTab(p.activeTerminalId)}>重启</button>}
    </div>
    <div className="relative flex min-h-0 flex-1">
      {p.terminalTabs.map((tab) => (
        <div key={tab.id} className={`${p.splitTerminalId ? 'relative w-1/2 border-r' : 'absolute inset-0'} min-h-0`} style={{ display: tab.id === p.activeTerminalId || tab.id === p.splitTerminalId ? 'flex' : 'none' }}>
          <TerminalSingle {...tab} profile={tab.profile} cwd={tab.cwd ?? p.workspacePath} theme={p.resolvedTheme === 'dark' ? 'dark' : 'light'}
            onOutput={p.handleTerminalOutput}
            onTitleChange={(id, title) => p.setTerminalTabs((prev) => prev.map((item) => item.id === id ? { ...item, title } : item))}
            onExit={(id, code) => { p.setTerminalTabs((prev) => prev.map((item) => item.id === id ? { ...item, alive: false, exitCode: code } : item)); p.appendOutput(`终端进程退出，代码 ${code}`); }} />
        </div>
      ))}
    </div>
  </div>
);

const ProblemsTabContent: React.FC<BottomPanelProps> = (p) => (
  <div className="py-1">
    {p.allProblems.length > 1 && <div className="flex border-b px-3 py-1"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const msgs = p.allProblems.slice(0, 5).map((pr) => `${pr.message}（${pr.path.split('/').pop()}:${pr.line}）`).join('；'); p.setAiInstruction(`批量修复以下问题：${msgs}`); p.setBottomPanel((prev) => ({ ...prev, tab: 'ai' })); }}>批量 AI 修复（前 5 个）</Button></div>}
    {p.allProblems.map((problem, i) => (
      <div key={`${problem.path}:${problem.line}:${problem.column}:${i}`} className="group flex min-h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => {
          const doc = p.documents.find((d) => problem.path.endsWith(d.path.replace(/\\/g, '/')));
          if (doc) { p.pendingRevealRef.current = { path: doc.path, line: problem.line, column: problem.column }; p.setActivePath(doc.path); }
          else p.setStatus(`问题位置：${problem.path.replace(/^.*?file:\/\//, '').replace(/^\//, '')}:${problem.line}:${problem.column}`);
        }}>
          <span className={problem.severity === monaco.MarkerSeverity.Error ? 'text-destructive' : 'text-warning'}>{problem.severity === monaco.MarkerSeverity.Error ? '●' : '▲'}</span>
          <span className="min-w-0 flex-1 truncate">{problem.message}</span>
          <span className="shrink-0 text-muted-foreground">{problem.path.split('/').pop()} [{problem.line}, {problem.column}]</span>
        </button>
        <button className="rounded px-1.5 py-0.5 text-[10px] opacity-0 hover:bg-background group-hover:opacity-100" onClick={() => { p.setAiInstruction(`修复以下问题：${problem.message}（${problem.path}:${problem.line}:${problem.column}）`); p.setBottomPanel((prev) => ({ ...prev, tab: 'ai' })); }}>AI 修复</button>
      </div>
    ))}
    {p.allProblems.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">未发现问题</div>}
  </div>
);

const OutlineTabContent: React.FC<BottomPanelProps> = (p) => (
  <div className="py-1">
    {p.symbols.map((s) => (
      <button key={`${s.name}:${s.line}`} className="flex h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent" style={{ paddingLeft: 12 + s.depth * 14 }}
        onClick={() => { p.editorRef.current?.setPosition({ lineNumber: s.line, column: s.column }); p.editorRef.current?.revealLineInCenter(s.line); p.editorRef.current?.focus(); }}>
        <Code className="h-3.5 w-3.5 text-primary" /><span className="truncate">{s.name}</span><span className="text-muted-foreground">{s.detail}</span><span className="ml-auto text-muted-foreground">:{s.line}</span>
      </button>
    ))}
    {p.symbols.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">当前文档没有可显示的符号</div>}
  </div>
);

const SourceControlTabContent: React.FC<BottomPanelProps> = (p) => {
  const [historyQuery, setHistoryQuery] = React.useState('');
  const [historyAuthor, setHistoryAuthor] = React.useState('');
  const [historySince, setHistorySince] = React.useState('');
  const [historyUntil, setHistoryUntil] = React.useState('');
  const [compareSelection, setCompareSelection] = React.useState<string[]>([]);
  const filters = { query: historyQuery, author: historyAuthor, since: historySince, until: historyUntil };
  return (
  <div className="flex min-h-full flex-col py-1">
    <div className="flex flex-wrap items-center gap-1 border-b p-2 text-xs">
      <select value={p.gitOverview?.branch ?? ''} disabled={!!p.gitBusy} onChange={(e) => { const branch = p.gitOverview?.branches.find((item) => item.name === e.target.value); void p.runGitOperation('switchBranch', { name: e.target.value, track: branch?.remote }); }} className="h-8 max-w-56 rounded border bg-background px-2">
        {(p.gitOverview?.branches ?? []).map((b) => <option key={b.name} value={b.name}>{b.current ? '✓ ' : ''}{b.remote ? '远程 · ' : ''}{b.name}{b.upstream ? ` → ${b.upstream}` : ''}{b.ahead ? ` ↑${b.ahead}` : ''}{b.behind ? ` ↓${b.behind}` : ''}</option>)}
      </select>
      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => { const n = await p.appPrompt('新分支名称'); if (n) void p.runGitOperation('createBranch', { name: n }); }}>新建分支</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive" disabled={!!p.gitBusy || !p.gitOverview?.branch} onClick={async () => { const n = await p.appPrompt('删除分支名称'); if (n && await p.appConfirm(`确定删除分支 ${n}？`)) void p.runGitOperation('deleteBranch', { name: n }); }}>删除分支</Button>
      {(p.gitOverview?.ahead ?? 0) > 0 && <span className="text-success">↑{p.gitOverview?.ahead}</span>}
      {(p.gitOverview?.behind ?? 0) > 0 && <span className="text-warning">↓{p.gitOverview?.behind}</span>}
      <select value={p.pullStrategy} disabled={!!p.gitBusy} onChange={(e) => p.setPullStrategy(e.target.value as 'ff-only' | 'merge' | 'rebase')} className="h-8 rounded border bg-background px-1 text-[10px]" title="拉取策略">{[{v:'ff-only',l:'FF'},{v:'merge',l:'Merge'},{v:'rebase',l:'Rebase'}]?.map(({v,l}) => <option key={v} value={v}>{l}</option>)}</select>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={() => void p.runGitOperation('fetch')}>Fetch</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={() => void p.runGitOperation('diagnostics')}>诊断</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={() => void p.runGitOperation('pull', { strategy: p.pullStrategy })}>拉取</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => {
        if (p.gitOverview?.upstream) { void p.runGitOperation('push'); return; }
        const names = [...new Set((p.gitOverview?.remotes ?? []).map((line) => line.split(/\s+/)[0]).filter(Boolean))];
        const remote = await p.appPrompt(`首次 Push，请选择 Remote${names.length ? `（${names.join(', ')}）` : ''}`, names[0] ?? 'origin');
        if (remote) void p.runGitOperation('push', { setUpstream: true, remote });
      }}>推送</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive" disabled={!!p.gitBusy || !p.gitOverview?.upstream} onClick={async () => {
        if (!await p.appConfirm('force-with-lease 会重写远程历史，但会保护他人的新提交。是否继续？')) return;
        if (!await p.appConfirm(`再次确认：使用 force-with-lease 推送 ${p.gitOverview?.branch ?? '当前分支'}？`)) return;
        void p.runGitOperation('push', { forceWithLease: true });
      }}>Force Lease</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={() => void p.runGitOperation('sync', { strategy: p.pullStrategy })}>同步</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => { const m = await p.appPrompt('Stash 说明（可选）') ?? ''; void p.runGitOperation('stashPush', { message: m }); }}>Stash</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => { const n = await p.appPrompt('Tag 名称'); if (n) void p.runGitOperation('createTag', { name: n }); }}>新建 Tag</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => { const n = await p.appPrompt('Remote 名称', 'origin'); const u = n ? await p.appPrompt('Remote URL') : null; if (n && u) void p.runGitOperation('addRemote', { name: n, url: u }); }}>添加 Remote</Button>
      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!!p.gitBusy} onClick={async () => { const kind = await p.appPrompt('继续操作类型：merge / rebase / cherry-pick', 'merge'); if (kind) void p.runGitOperation('continueOperation', { kind }); }}>Continue</Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive" disabled={!!p.gitBusy} onClick={async () => { const kind = await p.appPrompt('中止操作类型：merge / rebase / cherry-pick', 'merge'); if (kind && await p.appConfirm(`确定中止 ${kind}？`)) void p.runGitOperation('abortOperation', { kind }); }}>Abort</Button>
      {p.gitBusy && <span className="ml-auto text-muted-foreground">正在执行 {p.gitBusy.operation}…</span>}
      {p.gitBusy && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive" onClick={p.cancelGitOp}>取消</Button>}
    </div>
    <div className="flex h-8 items-center gap-1 border-b px-2 text-xs">
      {(['changes', 'history', 'stash'] as const).map((v) => <button key={v} className={`h-full border-b-2 px-2 ${p.gitView === v ? 'border-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => p.setGitView(v)}>{v === 'changes' ? `更改 (${p.gitStatus.length})` : v === 'history' ? `历史 (${p.gitHistory.length})` : 'Stash / Tags / Remotes'}</button>)}
    </div>
    {p.gitView === 'changes' && <>
      <div className="flex gap-2 border-b p-2">
        <input value={p.commitMessage} onChange={(e) => p.setCommitMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void p.commitGitChanges(); }} placeholder="提交消息（Ctrl+Enter 提交）" className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none" />
        <Button size="sm" className="h-8 px-3 text-xs" disabled={!p.commitMessage.trim() || !p.gitStatus.some((e) => e.status[0] !== ' ' && e.status[0] !== '?')} onClick={() => void p.commitGitChanges()}>提交</Button>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void Promise.all([p.refreshGitStatus(), p.refreshGitOverview()])}>刷新</Button>
      </div>
      {p.gitStatus.map((e) => (
        <div key={`${e.status}:${e.path}`} className="group flex h-7 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent">
          <span className="w-5 shrink-0 font-mono text-primary">{e.status.trim() || '?'}</span>
          {classifyConflictStatus(e.status) && <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] text-destructive">{classifyConflictStatus(e.status)}</span>}
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => void p.showGitDiff(e)} title="查看相对 HEAD 的 Diff">{e.path}</button>
          <button className="rounded px-1.5 py-0.5 opacity-0 hover:bg-background group-hover:opacity-100" onClick={() => void p.updateGitStage(e, e.status[0] === ' ' || e.status === '??')}>{e.status[0] !== ' ' && e.status[0] !== '?' ? '取消暂存' : '暂存'}</button>
        </div>
      ))}
      {p.gitStatus.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">工作区干净，或当前目录不是 Git 仓库</div>}
    </>}
    {p.gitView === 'history' && <div className="min-h-0 flex-1 overflow-auto py-1">
      <div className="sticky top-0 z-10 grid grid-cols-4 gap-1 border-b bg-background p-2">
        <input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="消息筛选" className="h-7 rounded border bg-background px-2 text-xs" />
        <input value={historyAuthor} onChange={(e) => setHistoryAuthor(e.target.value)} placeholder="作者筛选" className="h-7 rounded border bg-background px-2 text-xs" />
        <input type="date" value={historySince} onChange={(e) => setHistorySince(e.target.value)} className="h-7 rounded border bg-background px-2 text-xs" />
        <div className="flex gap-1"><input type="date" value={historyUntil} onChange={(e) => setHistoryUntil(e.target.value)} className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs" /><Button size="sm" className="h-7 px-2 text-xs" onClick={() => void p.loadGitHistory(filters)}>筛选</Button></div>
      </div>
      {compareSelection.length === 2 && <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-1 text-xs"><span>比较 {compareSelection[0].slice(0, 7)}..{compareSelection[1].slice(0, 7)}</span><Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => void p.compareGitCommits(compareSelection[0], compareSelection[1])}>打开 Diff</Button><button onClick={() => setCompareSelection([])}>清除</button></div>}
      <GitHistoryGraph
        commits={p.gitHistory}
        selectedHashes={compareSelection}
        onToggleSelection={(hash) => setCompareSelection((current) => (
          current.includes(hash) ? current.filter((item) => item !== hash) : [...current.slice(-1), hash]
        ))}
        onOpenCommit={async (commit) => {
          const result = await window.electronAPI.workspace.gitOperation<string>(p.workspacePath || '', 'showCommit', { hash: commit.hash });
          if (result.success) {
            p.setDiffView({
              path: commit.hash,
              name: `${commit.shortHash} ${commit.subject}`,
              original: '',
              modified: result.data ?? '',
              language: 'diff',
              source: 'external',
            });
          }
        }}
      />
      <div className="p-2 text-center"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void p.loadGitHistory(filters, true)}>加载更多</Button></div>
    </div>}
    {p.gitView === 'stash' && <div className="grid grid-cols-[100px_1fr] gap-2 p-3 text-xs">
      <span>Tags</span><div className="flex items-start gap-2"><span className="flex-1 break-all text-muted-foreground">{p.gitOverview?.tags.join(', ') || '无'}</span><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { const n = await p.appPrompt('要删除的 Tag'); if (n) void p.runGitOperation('deleteTag', { name: n }); }}>删除</Button></div>
      <span>Remotes</span><div className="flex items-start gap-2"><pre className="flex-1 whitespace-pre-wrap text-muted-foreground">{p.gitOverview?.remotes.join('\n') || '无'}</pre><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { const n = await p.appPrompt('要删除的 Remote'); if (n) void p.runGitOperation('removeRemote', { name: n }); }}>删除</Button></div>
      <span>Stash</span><div className="flex gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => { await window.electronAPI.workspace.gitOperation(p.workspacePath || '', 'stashList'); }}>查看列表</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { const ref = await p.appPrompt('Stash 引用', 'stash@{0}'); if (ref) void p.runGitOperation('stashApply', { ref }); }}>应用</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { const ref = await p.appPrompt('Stash 引用', 'stash@{0}'); if (!ref) return; void p.runGitOperation('stashShow', { ref }); }}>Diff</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { const ref = await p.appPrompt('Stash 引用', 'stash@{0}'); if (ref) void p.runGitOperation('stashPop', { ref }); }}>Pop</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={async () => { const ref = await p.appPrompt('要删除的 Stash', 'stash@{0}'); if (ref) void p.runGitOperation('stashDrop', { ref }); }}>删除</Button>
      </div>
    </div>}
  </div>
  );
};

const AiTabContent: React.FC<BottomPanelProps> = (p) => (
  <div className="flex h-full min-h-0 flex-col gap-2 p-3">
    <div className="text-xs text-muted-foreground">描述希望对当前文件执行的修改。AI 结果会先进入 Diff，不会自动保存。</div>
    <div className="flex flex-wrap items-center gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={p.aiMultiFile} onChange={(e) => p.setAiMultiFile(e.target.checked)} />多文件 Agent（自动筛选相关文件）</label><label className="flex items-center gap-1">Token 预算 <input type="number" min={4000} max={64000} step={1000} value={p.aiTokenBudget} onChange={(e) => p.setAiTokenBudget(Math.max(4000, Math.min(64000, Number(e.target.value) || 24000)))} className="h-7 w-20 rounded border bg-background px-1" /></label><span className={p.aiEstimatedTokens > p.aiTokenBudget ? 'text-warning' : 'text-muted-foreground'}>当前约 {p.aiEstimatedTokens} tokens</span><span className="text-muted-foreground">待审阅 {p.aiProposals.length}</span><span className="text-muted-foreground">已接受 {p.aiHistory.length}</span><span className="text-muted-foreground">会话 {p.aiSessions.length}</span><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={p.aiHistory.length === 0} onClick={p.undoLastAiEdit}>撤销上次 AI 修改</Button></div>
    {p.aiSessions.length > 0 && <div className="max-h-24 overflow-auto border-t px-3 py-1"><div className="text-[10px] font-semibold text-muted-foreground">最近会话</div>{p.aiSessions.slice(-5).reverse().map((s) => <div key={s.id} className="flex items-center gap-2 py-0.5 text-[10px] text-muted-foreground"><span className="max-w-32 truncate">{s.instruction}</span><span>{s.filesChanged} 文件</span><span>{new Date(s.timestamp).toLocaleTimeString()}</span></div>)}</div>}
    {p.aiPendingRequest && <div className="rounded border border-warning/40 bg-warning/5 px-2 py-1 text-[10px] text-warning">{p.aiPendingRequest.status === 'running' ? '请求执行中' : '上次请求中断，可直接重新生成'}：{p.aiPendingRequest.instruction}</div>}
    {p.aiMessages.length > 0 && <div className="max-h-28 overflow-auto rounded border px-2 py-1 text-[10px]">{p.aiMessages.slice(-10).map((message, index) => <div key={`${message.timestamp}:${index}`} className="flex gap-2 py-0.5"><span className="w-12 shrink-0 font-medium text-primary">{message.role}</span><span className="whitespace-pre-wrap text-muted-foreground">{message.content.slice(0, 500)}{message.content.length > 500 ? '…' : ''}</span></div>)}</div>}
    <textarea value={p.aiInstruction} onChange={(e) => p.setAiInstruction(e.target.value)} placeholder="例如：重构这个组件，拆分重复逻辑并补充错误处理" className="min-h-20 flex-1 resize-none rounded border bg-background p-2 text-xs outline-none" />
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" className="mr-2" disabled={!p.activeDocument} onClick={() => { p.setAiMultiFile(true); p.setAiInstruction(`为 ${p.activeDocument?.path ?? '当前模块'} 生成或完善单元测试，复用项目现有测试框架和约定`); }}>生成测试</Button>
      {p.aiEditing
        ? <Button size="sm" variant="destructive" onClick={p.cancelAiEdit}>取消生成</Button>
        : <Button size="sm" disabled={!p.activeDocument || !p.aiInstruction.trim()} onClick={() => void p.generateAiEdit()}>{p.aiPendingRequest?.status === 'interrupted' ? '重新生成' : '生成修改并预览'}</Button>}
    </div>
  </div>
);

const SettingsTabContent: React.FC<BottomPanelProps> = (p) => (
  <div className="grid max-w-2xl grid-cols-[180px_1fr] items-center gap-x-4 gap-y-3 p-4 text-xs">
    <label htmlFor="editor-font-size">字体大小</label>
    <input id="editor-font-size" type="number" min={10} max={32} value={p.preferences.fontSize} onChange={(e) => p.setPreferences((prev) => ({ ...prev, fontSize: Number(e.target.value) || 13 }))} className="h-8 rounded border bg-background px-2" />
    <label htmlFor="editor-tab-size">Tab Size</label>
    <select id="editor-tab-size" value={p.preferences.tabSize} onChange={(e) => p.setPreferences((prev) => ({ ...prev, tabSize: Number(e.target.value) }))} className="h-8 rounded border bg-background px-2"><option value={2}>2</option><option value={4}>4</option><option value={8}>8</option></select>
    <span>自动换行</span><input type="checkbox" checked={p.preferences.wordWrap === 'on'} onChange={(e) => p.setPreferences((prev) => ({ ...prev, wordWrap: e.target.checked ? 'on' : 'off' }))} />
    <span>Minimap</span><input type="checkbox" checked={p.preferences.minimap} onChange={(e) => p.setPreferences((prev) => ({ ...prev, minimap: e.target.checked }))} />
    <span>保存时格式化</span><input type="checkbox" checked={p.preferences.formatOnSave} onChange={(e) => p.setPreferences((prev) => ({ ...prev, formatOnSave: e.target.checked }))} />
    <label htmlFor="terminal-profile">默认终端 Profile</label>
    <div className="flex gap-2"><select id="terminal-profile" value={p.terminalProfileName} onChange={(e) => p.setTerminalProfileName(e.target.value)} className="h-8 min-w-0 flex-1 rounded border bg-background px-2">{p.terminalProfiles.map((pr) => <option key={pr.name}>{pr.name}</option>)}</select><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void p.addTerminalProfile()}>添加 Profile</Button></div>
    <label htmlFor="terminal-env">终端环境变量 <button type="button" className="ml-1 rounded px-1 text-[10px] hover:bg-accent" onClick={() => p.setShowEnvValues((v) => !v)}>{p.showEnvValues ? '隐藏值' : '显示值'}</button><button type="button" className="ml-1 rounded px-1 text-[10px] text-primary hover:bg-accent" onClick={() => void p.saveTerminalSecret()}>安全保存 Secret</button></label>
    <div className="flex flex-col gap-1">
      <textarea id="terminal-env" value={p.showEnvValues ? p.terminalEnvText : p.terminalEnvText.replace(/=.*/gm, '=••••')} onChange={(e) => p.setTerminalEnvText(e.target.value)} onFocus={() => !p.showEnvValues && p.setShowEnvValues(true)} placeholder="KEY=value\nANOTHER=${workspaceFolder}/bin" className="min-h-20 rounded border bg-background p-2 font-mono text-xs" spellCheck={false} />
      {p.terminalEnvText.split(/\r?\n/).some((l) => l.trim() && !/^[A-Z_][A-Z0-9_]*=.+$/i.test(l.trim())) && <span className="text-[10px] text-warning">格式：KEY=value（一行一个）</span>}
    </div>
  </div>
);
