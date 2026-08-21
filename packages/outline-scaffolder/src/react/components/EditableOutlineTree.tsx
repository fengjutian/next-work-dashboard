import React, { useState } from "react";
import { FileText } from "lucide-react";
import type { OutlineNode } from "../../core/outline";

export interface EditableOutlineTreeProps {
  nodes: OutlineNode[];
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onMove(id: string, direction: -1 | 1): void;
}

export function EditableOutlineTree({ nodes, onRename, onDelete, onMove }: EditableOutlineTreeProps) {
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="group flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {editingId === node.id ? (
              <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && draft.trim()) { onRename(node.id, draft.trim()); setEditingId(""); }
                  if (event.key === "Escape") setEditingId("");
                }}
                onBlur={() => { if (draft.trim()) onRename(node.id, draft.trim()); setEditingId(""); }}
                className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm" />
            ) : <span className="min-w-0 flex-1 truncate">{node.title}</span>}
            <button type="button" title="上移" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100" onClick={() => onMove(node.id, -1)}>↑</button>
            <button type="button" title="下移" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100" onClick={() => onMove(node.id, 1)}>↓</button>
            <button type="button" className="text-xs text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100"
              onMouseDown={(event) => event.preventDefault()} onClick={() => { setEditingId(node.id); setDraft(node.title); }}>修改</button>
            <button type="button" className="text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" onClick={() => onDelete(node.id)}>删除</button>
          </div>
          {node.children.length > 0 && <div className="ml-5 border-l border-border pl-2">
            <EditableOutlineTree nodes={node.children} onRename={onRename} onDelete={onDelete} onMove={onMove} />
          </div>}
        </li>
      ))}
    </ul>
  );
}
