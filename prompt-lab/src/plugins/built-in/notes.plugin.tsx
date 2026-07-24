import React, { useState } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * Notes 插件 — 一个简单的便签面板，演示自定义插件如何接入侧边栏。
 *
 * 功能：
 *  - 多便签创建/删除
 *  - 自动保存到 localStorage
 *  - 选择即编辑
 */
interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

const STORAGE_KEY = 'plugin-notes-data';

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export const NotesPanel: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [selectedId, setSelectedId] = useState<string | null>(
    notes.length > 0 ? notes[0].id : null
  );

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const addNote = () => {
    const note: Note = {
      id: Date.now().toString(36),
      title: '新便签',
      content: '',
      createdAt: Date.now(),
    };
    const next = [note, ...notes];
    setNotes(next);
    saveNotes(next);
    setSelectedId(note.id);
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(next);
    if (selectedId === id) {
      setSelectedId(next.length > 0 ? next[0].id : null);
    }
  };

  const updateNote = (id: string, patch: Partial<Note>) => {
    const next = notes.map((n) => (n.id === id ? { ...n, ...patch } : n));
    setNotes(next);
    saveNotes(next);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-yellow-500" />
          <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
            便签
          </h2>
          <span className="text-xs text-zinc-400">{notes.length} 条</span>
        </div>
        <Button size="sm" variant="outline" onClick={addNote}>
          + 新建
        </Button>
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧列表 */}
        <div className="w-52 border-r flex flex-col">
          <ScrollArea className="flex-1">
            {notes.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">
                暂无便签，点击"新建"创建
              </p>
            ) : (
              notes.map((note) => (
                <button
                  key={note.id}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-zinc-100 dark:border-zinc-800 transition-colors group ${
                    selectedId === note.id
                      ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                  }`}
                  onClick={() => setSelectedId(note.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-medium">
                      {note.title || '未命名'}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                      }}
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {note.content.slice(0, 40) || '空内容'}
                  </p>
                </button>
              ))
            )}
          </ScrollArea>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 flex flex-col p-4">
          {selected ? (
            <>
              <input
                className="text-lg font-semibold bg-transparent border-none outline-none text-zinc-800 dark:text-zinc-200 mb-3"
                value={selected.title}
                onChange={(e) => updateNote(selected.id, { title: e.target.value })}
                placeholder="标题"
              />
              <textarea
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed"
                value={selected.content}
                onChange={(e) => updateNote(selected.id, { content: e.target.value })}
                placeholder="写点什么..."
              />
            </>
          ) : (
            <p className="text-sm text-zinc-400 text-center py-16">
              选择一个便签或新建一个
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
