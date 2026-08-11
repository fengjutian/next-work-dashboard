/**
 * source-mode — 源码模式下的纯文本编辑体验。
 *
 * P0 暂用 textarea 实现（保持包体最小、避免 Monaco 在 markdown 源码场景
 * 的 language server 开销）。后续 P1 可无缝替换为 CodeMirror / Monaco，
 * 因为对外只暴露 MarkdownSourceEditor 这个 React 组件 props 契约。
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export interface MarkdownSourceEditorHandle {
  focus(): void;
  scrollTo(position: { line: number; column: number }): void;
  getValue(): string;
  setValue(value: string): void;
}

export interface MarkdownSourceEditorProps {
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  /** 文本内容变化时回调（已统一换行符为 \n） */
  onChange: (value: string) => void;
  /** Ctrl/Cmd+S 触发保存 */
  onSaveShortcut?: () => void;
  className?: string;
}

/**
 * 简化版源码编辑器：textarea + 基础快捷键。
 * 高度填满父容器，使用等宽字体保证代码块可读。
 */
export const MarkdownSourceEditor = forwardRef<MarkdownSourceEditorHandle, MarkdownSourceEditorProps>(
  ({ value, placeholder, readOnly, onChange, onSaveShortcut, className }, ref) => {
    const refTextarea = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => refTextarea.current?.focus(),
      scrollTo: ({ line, column }) => {
        const ta = refTextarea.current;
        if (!ta) return;
        const lines = ta.value.split('\n');
        let pos = 0;
        for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) pos += lines[i].length + 1;
        pos += Math.max(0, column - 1);
        ta.setSelectionRange(pos, pos);
        const lineHeight = 20;
        ta.scrollTop = Math.max(0, (line - 3) * lineHeight);
      },
      getValue: () => refTextarea.current?.value ?? '',
      setValue: (next) => {
        if (refTextarea.current) refTextarea.current.value = next;
      },
    }));

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSaveShortcut?.();
        return;
      }
      // Tab 缩进 2 空格
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        const ta = event.currentTarget;
        const { selectionStart, selectionEnd, value: current } = ta;
        const indent = '  ';
        const newValue = current.slice(0, selectionStart) + indent + current.slice(selectionEnd);
        ta.value = newValue;
        const newPos = selectionStart + indent.length;
        ta.setSelectionRange(newPos, newPos);
        onChange(newValue);
      }
    };

    return (
      <textarea
        ref={refTextarea}
        defaultValue={value}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className={
          'h-full w-full resize-none bg-background p-6 font-mono text-sm leading-6 text-foreground outline-none ' +
          'border-0 focus:ring-0 ' +
          (className ?? '')
        }
      />
    );
  },
);

MarkdownSourceEditor.displayName = 'MarkdownSourceEditor';
