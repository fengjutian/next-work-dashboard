import React from 'react';
import { Bot, FileText, FolderOpen, PanelLeft, Plus, Search } from '../../components/icons';
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
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onToggleSidebar} title="切换资源管理器 (Ctrl+B)">
      <PanelLeft className="h-4 w-4" />
    </Button>
    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => onOpenWorkspace(false)}>
      <FolderOpen className="h-4 w-4" /> 打开文件夹
    </Button>
    {workspaceOpen && <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => onOpenWorkspace(true)}>
      <Plus className="h-3.5 w-3.5" /> 添加文件夹
    </Button>}
    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onOpenFile}>
      <FileText className="h-4 w-4" /> 打开文件
    </Button>
    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onOpenSearch} disabled={!workspaceOpen}>
      <Search className="h-4 w-4" /> 全文搜索
    </Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!workspaceOpen} onClick={onSemanticSearch} title="跨工作区搜索定义、引用和 import">语义搜索</Button>
    <div className="flex-1" />
    <Button size="sm" variant={agentsOpen ? 'secondary' : 'ghost'} className="h-7 gap-1.5 px-2 text-xs" onClick={onToggleAgents} title="打开 Agents Window">
      <Bot className="h-4 w-4" /> Agents
    </Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={() => onEditorAction('editor.action.revealDefinition', '当前位置没有可跳转的定义')} title="转到定义 (F12)">定义</Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={() => onEditorAction('editor.action.referenceSearch.trigger', '当前位置没有可查找的引用')} title="查找所有引用 (Shift+F12)">引用</Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument} onClick={onFormat} title="格式化文档 (Shift+Alt+F)">格式化</Button>
    <Button size="sm" variant={bottomPanelOpen ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={onTogglePanel}>面板</Button>
    <Button size="sm" variant={autoSave ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={onToggleAutoSave}>自动保存</Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!activeDocument || activeDocument.content === activeDocument.savedContent} onClick={onSave}>保存</Button>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!hasDirtyDocuments} onClick={onSaveAll}>全部保存</Button>
  </header>
);
