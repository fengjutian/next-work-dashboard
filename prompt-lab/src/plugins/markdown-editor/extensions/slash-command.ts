/**
 * Slash Command Tiptap 扩展 — 输入 / 弹出可插入的节点清单。
 *
 * 实现：
 *  - 复用 @tiptap/suggestion 监听 "/" 触发
 *  - 在空行/段落开头允许触发
 *  - 弹窗由 React 组件 SlashCommandPopup 渲染（通过 render.onStart / onUpdate / onExit 挂载）
 *  - 选中后从 query 中删除 "/" 和搜索词，然后插入目标节点
 *
 * 设计要点：
 *  - 不引外部 headless UI 库；popup 是普通 absolute div
 *  - 列表项的图标复用项目已有的 lucide-react 别名
 */

import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import { SlashCommandPopup } from '../components/SlashCommandPopup';
import { filterCommands, type SlashCommandItem } from '../editor/slash-commands';

type PopupInstance = {
  renderer: ReactRenderer;
  cleanup: () => void;
};

const POPUP_KEY = 'markdown-editor-slash-command';

export type { SlashCommandItem } from '../editor/slash-commands';
export { SLASH_COMMANDS, filterCommands, findCommand } from '../editor/slash-commands';

export const SlashCommandExtension = Extension.create({
  name: 'markdownEditorSlashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
          // 删除触发文本，然后执行命令
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        items: ({ query }: { query: string }) => filterCommands(query),
        render: () => {
          let popup: PopupInstance | null = null;
          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              const renderer = new ReactRenderer(SlashCommandPopup, {
                props: { ...props, items: filterCommands(props.query) },
                editor: props.editor,
              });
              popup = {
                renderer,
                cleanup: () => {
                  renderer.element.remove();
                  renderer.destroy();
                },
              };
              // 挂载到 document.body，用 absolute 定位
              const element = renderer.element as HTMLElement;
              element.style.position = 'absolute';
              element.style.zIndex = '50';
              positionPopup(element, props.clientRect);
              document.body.appendChild(element);
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              if (!popup) return;
              popup.renderer.updateProps({ ...props, items: filterCommands(props.query) });
              const element = popup.renderer.element as HTMLElement;
              positionPopup(element, props.clientRect);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                popup?.cleanup();
                popup = null;
                return true;
              }
              return (popup?.renderer.ref as { onKeyDown?: (e: KeyboardEvent) => boolean } | undefined)?.onKeyDown?.(props.event) ?? false;
            },
            onExit: () => {
              popup?.cleanup();
              popup = null;
            },
          };
        },
      } satisfies Partial<SuggestionOptions<SlashCommandItem>>,
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

function positionPopup(element: HTMLElement, clientRect: (() => DOMRect | null) | null): void {
  if (!clientRect) return;
  const rect = clientRect();
  if (!rect) return;
  const popupHeight = element.offsetHeight || 280;
  const popupWidth = element.offsetWidth || 280;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let top = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;
  // 避免超出右边界
  if (left + popupWidth > viewportWidth - 8) {
    left = Math.max(8, viewportWidth - popupWidth - 8);
  }
  // 避免超出下边界，向上翻
  if (rect.bottom + popupHeight + 8 > viewportHeight && rect.top - popupHeight - 8 > 0) {
    top = rect.top + window.scrollY - popupHeight - 4;
  }
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
}
