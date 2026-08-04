import React from 'react';
import {
  BookOpen, Bot, Code, FileText, FolderOpen, Network, PanelLeft, PanelRight,
  Plus, RefreshCw, Save, SaveAll, Search, Sparkles,
} from '../../components/icons';
import { Button } from '../../components/ui/button';
import type { OpenDocument } from './editor-types';

interface WorkspaceToolbarProps {
  workspaceOpen: boolean;
  activeDocument: OpenDocument | null;
  hasDirtyDocuments: boolean;
  autoSave: boolean;
  bottomPanelOpen: boolean;
  agentsOpen: boolean;
  onToggleSidebar: () => void;
  onOpenWorkspace: (add: boolean) => void;
  onOpenFile: () => void;
  onOpenSearch: () => void;
  onSemanticSearch: () => void;
  onEditorAction: (id: string, unavailable: string) => void;
  onFormat: () => void;
  onTogglePanel: () => void;
  onToggleAgents: () => void;
  onToggleAutoSave: () => void;
  onSave: () => void;
  onSaveAll: () => void;
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  workspaceOpen, activeDocument, hasDirtyDocuments, autoSave, bottomPanelOpen, agentsOpen,
  onToggleSidebar, onOpenWorkspace, onOpenFile, onOpenSearch, onSemanticSearch,
  onEditorAction, onFormat, onTogglePanel, onToggleAgents, onToggleAutoSave, onSave, onSaveAll,
}) => (
  <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onToggleSidebar} title="切换资源管理器 (Ctrl+B)" aria-label="切换资源管理器">
      <PanelLeft className="h-4 w-4" />
    </Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onOpenWorkspace(false)} title="打开文件夹" aria-label="打开文件夹">
      <FolderOpen className="h-4 w-4" />
    </Button>
    {workspaceOpen && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onOpenWorkspace(true)} title="添加工作区文件夹" aria-label="添加工作区文件夹">
      <Plus className="h-4 w-4" />
    </Button>}
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onOpenFile} title="打开文件" aria-label="打开文件">
      <FileText className="h-4 w-4" />
    </Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onOpenSearch} disabled={!workspaceOpen} title="全文搜索" aria-label="全文搜索">
      <Search className="h-4 w-4" />
    </Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!workspaceOpen} onClick={onSemanticSearch} title="语义搜索：定义、引用和 import" aria-label="语义搜索"><Network className="h-4 w-4" /></Button>
    <div className="mx-1 h-4 w-px bg-border" />
    <div className="flex-1" />
    <Button size="sm" variant={agentsOpen ? 'secondary' : 'ghost'} className="relative h-7 w-7 p-0" onClick={onToggleAgents} title={agentsOpen ? '关闭 Agents' : '打开 Agents'} aria-label={agentsOpen ? '关闭 Agents' : '打开 Agents'} aria-pressed={agentsOpen}>
      <Bot className="h-4 w-4" />
      {agentsOpen && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
    </Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!activeDocument} onClick={() => onEditorAction('editor.action.revealDefinition', '当前位置没有可跳转的定义')} title="转到定义 (F12)" aria-label="转到定义"><Code className="h-4 w-4" /></Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!activeDocument} onClick={() => onEditorAction('editor.action.referenceSearch.trigger', '当前位置没有可查找的引用')} title="查找所有引用 (Shift+F12)" aria-label="查找所有引用"><BookOpen className="h-4 w-4" /></Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!activeDocument} onClick={onFormat} title="格式化文档 (Shift+Alt+F)" aria-label="格式化文档"><Sparkles className="h-4 w-4" /></Button>
    <Button size="sm" variant={bottomPanelOpen ? 'secondary' : 'ghost'} className="h-7 w-7 p-0" onClick={onTogglePanel} title={bottomPanelOpen ? '关闭底部面板' : '打开底部面板'} aria-label={bottomPanelOpen ? '关闭底部面板' : '打开底部面板'} aria-pressed={bottomPanelOpen}><PanelRight className="h-4 w-4 rotate-90" /></Button>
    <Button size="sm" variant={autoSave ? 'secondary' : 'ghost'} className="relative h-7 w-7 p-0" onClick={onToggleAutoSave} title={autoSave ? '关闭自动保存' : '开启自动保存'} aria-label={autoSave ? '关闭自动保存' : '开启自动保存'} aria-pressed={autoSave}><RefreshCw className="h-4 w-4" />{autoSave && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}</Button>
    <div className="mx-1 h-4 w-px bg-border" />
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!activeDocument || activeDocument.content === activeDocument.savedContent} onClick={onSave} title="保存当前文件 (Ctrl+S)" aria-label="保存当前文件"><Save className="h-4 w-4" /></Button>
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!hasDirtyDocuments} onClick={onSaveAll} title="保存全部文件" aria-label="保存全部文件"><SaveAll className="h-4 w-4" /></Button>
  </header>
);
