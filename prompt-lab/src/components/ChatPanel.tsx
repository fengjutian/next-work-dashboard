import React, { useState, useEffect } from 'react';
import { Wrench, MessageSquare, Send, Robot, Settings, Trash2, Plus, Download, ChevronDown, Bot } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { useChatSession, MODELS } from './chat/useChatSession';
import { MessageBubble } from './chat/MessageBubble';
import { setToolEnabled } from '@/core/tools';
import { ToolManagerDialog } from './chat/ToolManagerDialog';
import { PromptManagerDialog } from './chat/PromptManagerDialog';
import { RoleManagerDialog } from './chat/RoleManagerDialog';

// ── 空状态 ──

const EmptyChat: React.FC<{ hasKey: boolean }> = ({ hasKey }) => (
  <div className="flex-1 flex items-center justify-center">
    <div className="text-center space-y-4 max-w-sm">
      <Robot className="h-10 w-10 text-zinc-300 mx-auto" />
      {hasKey ? <><h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">AI 对话</h3><p className="text-xs text-zinc-400">输入消息开始对话，可开启 Agent 模式自动调用工具</p></>
        : <><h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">未配置 API Key</h3><p className="text-xs text-zinc-400">请在设置 → AI API 中配置后使用</p></>}
    </div>
  </div>
);

// ════════════════════════════════════════
// 主面板
// ════════════════════════════════════════

export const ChatPanel: React.FC = () => {
  const promptDrawerOpen = useStore((s) => s.promptDrawerOpen);
  const setPromptDrawerOpen = useStore((s) => s.setPromptDrawerOpen);
  const setActiveActivity = useStore((s) => s.setActiveActivity);
  const [toolManagerOpen, setToolManagerOpen] = useState(false);
  const [promptManagerOpen, setPromptManagerOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);

  const {
    sessions, activeSessionId, setActiveSessionId, showHistory, setShowHistory,
    messages, systemPrompt, currentModel, hasKey,
    input, setInput, streaming, agentMode, setAgentMode, error,
    sysPromptOpen, setSysPromptOpen,
    editingMsgId, editValue, setEditValue, setEditingMsgId,
    inputRef, scrollRef,
    handleNewSession, handleDeleteSession, handleExport,
    handleSend, handleRegenerate, handleStop, handleClear, handleKeyDown,
    handleStartEdit, handleSaveEdit,
    updateSessionMeta,
    boundPromptIds, toggleBoundPrompt,
  } = useChatSession();

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // ── 角色 Agent ──
  const roles = useStore((s) => s.roles);
  const activeRoleId = useStore((s) => s.activeRoleId);
  const activeRole = roles.find((r) => r.id === activeRoleId);

  // 角色激活/停用时自动应用设置
  useEffect(() => {
    if (activeRole) {
      updateSessionMeta({ systemPrompt: activeRole.systemPrompt });
      const tools = activeRole.enabledToolIds;
      const allTools = [
        'get_current_time', 'calculator', 'web_search', 'read_file',
        'clipboard_read', 'fetch_url', 'write_file', 'list_files',
        'read_file_content', 'read_pdf_document', 'read_word_document',
        'read_excel_spreadsheet', 'read_ppt_presentation', 'open_image',
      ];
      if (tools.length > 0) {
        allTools.forEach((t) => setToolEnabled(t, tools.includes(t)));
      } else {
        allTools.forEach((t) => setToolEnabled(t, true));
      }
    } else {
      // 停用角色时恢复全部工具
      const allTools = [
        'get_current_time', 'calculator', 'web_search', 'read_file',
        'clipboard_read', 'fetch_url', 'write_file', 'list_files',
        'read_file_content', 'read_pdf_document', 'read_word_document',
        'read_excel_spreadsheet', 'read_ppt_presentation', 'open_image',
      ];
      allTools.forEach((t) => setToolEnabled(t, true));
    }
  }, [activeRoleId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 flex h-full bg-white dark:bg-zinc-950">
      {/* 历史记录侧边栏 */}
      {showHistory && (
        <div className="w-64 border-r shrink-0 flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold text-zinc-500">对话历史</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHistory(false)}><span className="text-xs">✕</span></Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...sessions].sort((a, b) => b.createdAt - a.createdAt).map((s) => (
              <div key={s.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs border-b border-zinc-100 dark:border-zinc-800 transition-colors ${s.id === activeSessionId ? 'bg-blue-50 dark:bg-blue-950 text-blue-600' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}
                onClick={() => { setActiveSessionId(s.id); setShowHistory(false); }}>
                <span className="flex-1 truncate">{s.title}</span>
                <span className="text-[10px] text-zinc-400">{new Date(s.createdAt).toLocaleDateString()}</span>
                <button className="text-zinc-400 hover:text-red-500 ml-1" onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 主聊天区 */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* 头部 */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 flex-wrap">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} title="新建对话"><Plus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className={`h-7 w-7 ${showHistory ? 'text-blue-500' : ''}`} onClick={() => setShowHistory(!showHistory)} title="对话历史"><ChevronDown className={`h-4 w-4 transition-transform ${showHistory ? 'rotate-180' : ''}`} /></Button>
          <span className="text-xs font-medium text-zinc-500 truncate max-w-[120px]">{activeSession?.title || '新对话'}</span>
          <div className="flex-1" />

          <select
            className="h-6 text-[10px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 text-zinc-600 dark:text-zinc-400"
            value={currentModel}
            onChange={(e) => updateSessionMeta({ model: e.target.value })}
          >
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <button className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors ${agentMode ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`} onClick={() => setAgentMode((v) => !v)}>
            {agentMode ? 'Agent ✓' : 'Agent'}
          </button>

          <button
            onClick={() => setRoleManagerOpen(true)}
            className={`h-6 px-1.5 text-[10px] font-medium rounded-full transition-colors flex items-center gap-1 ${
              activeRole
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600'
            }`}
            title="角色管理"
          >
            <Bot className="h-3 w-3" />
            <span>{activeRole ? activeRole.name : '角色'}</span>
          </button>

          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" onClick={() => setToolManagerOpen(true)} title="工具管理">
            <Wrench className="h-3.5 w-3.5" />
          </Button>

          <Button variant="ghost" size="icon" className={`h-7 w-7 text-[10px] ${sysPromptOpen || systemPrompt ? 'text-blue-500' : 'text-zinc-400'}`} onClick={() => setSysPromptOpen((v) => !v)} title="系统提示词">Sys</Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" onClick={() => setPromptManagerOpen(true)} title="提示词管理">
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
          {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={handleClear} title="清空对话"><Trash2 className="h-3.5 w-3.5" /></Button>}
          {messages.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={handleExport} title="导出 Markdown"><Download className="h-3.5 w-3.5" /></Button>}
          {!hasKey && <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" onClick={() => setActiveActivity('settings')}><Settings className="h-3.5 w-3.5" /></Button>}
        </div>

        {/* 系统提示词 */}
        {sysPromptOpen && (
          <div className="px-3 py-2 border-b bg-zinc-50 dark:bg-zinc-900 shrink-0">
            <textarea
              className="w-full text-xs bg-white dark:bg-zinc-800 border rounded p-2 resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
              rows={2}
              placeholder="系统提示词 — 定义 AI 的角色和行为方式..."
              value={systemPrompt}
              onChange={(e) => updateSessionMeta({ systemPrompt: e.target.value })}
            />
          </div>
        )}

        {/* 消息区域 */}
        {messages.length === 0 ? (
          <EmptyChat hasKey={hasKey} />
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.map((msg) => {
              const nonTool = messages.filter((m) => m.role !== 'tool');
              const isLastUser = msg.role === 'user' && nonTool[nonTool.length - 1]?.id === msg.id;
              const isLastAssistant = msg.role === 'assistant' && nonTool[nonTool.length - 1]?.id === msg.id;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  canRegenerate={isLastAssistant && !streaming}
                  onRegenerate={handleRegenerate}
                  canEdit={isLastUser && !streaming}
                  onEdit={() => handleStartEdit(msg.id)}
                  editing={editingMsgId === msg.id}
                  editValue={editValue}
                  onEditChange={setEditValue}
                  onEditSave={handleSaveEdit}
                  onEditCancel={() => setEditingMsgId(null)}
                />
              );
            })}
            {error && <p className="text-xs text-red-500 text-center mb-2">{error}</p>}
          </div>
        )}

        {/* 输入区域 */}
        <div className="border-t p-3 shrink-0 bg-zinc-50 dark:bg-zinc-900">
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={!hasKey ? '请先在设置中配置 API Key' : agentMode ? 'Agent 模式：输入任务...' : '输入消息... (Enter 发送)'}
              disabled={!hasKey} rows={2}
              className="flex-1 resize-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50" />
            {streaming ? (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={handleStop}><span className="text-lg leading-none">■</span></Button>
            ) : (
              <Button size="icon" className={`h-9 w-9 shrink-0 ${agentMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'}`} onClick={handleSend} disabled={!input.trim() || !hasKey}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 历史记录侧边栏 */}
      {/* 工具管理弹层 */}
      <ToolManagerDialog open={toolManagerOpen} onClose={() => setToolManagerOpen(false)} />
      {/* 提示词管理弹层 */}
      <PromptManagerDialog
        open={promptManagerOpen}
        onClose={() => setPromptManagerOpen(false)}
        boundPromptIds={boundPromptIds}
        onToggleBound={toggleBoundPrompt}
      />
      {/* 角色 Agent 管理弹层 */}
      <RoleManagerDialog open={roleManagerOpen} onClose={() => setRoleManagerOpen(false)} />
    </div>
  );
};
