/**
 * Wiki Link Tiptap 扩展 — 输入 [[ 触发，从知识工作区选文档。
 *
 * 为什么不引 @tiptap/extension-mention：
 *  - 我们要插入的是纯文本 `[[target]]` 或 `[[target|label]]`，不是 mention 节点
 *  - 这样 roundtrip-guard 能用现有 wiki-link 提取逻辑正常工作
 *  - 也避免在保存时被 mention 节点"特殊化"
 *
 * 行为：
 *  - 触发字符 `[[`
 *  - items() 异步从 activeKnowledgeWorkspace.documents 拉
 *  - 选中后用 editor.commands.insertContent 插入 `[[label]]` 或 `[[label|target]]`
 */

import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { WikiLinkPopup, type WikiLinkItem } from '../components/WikiLinkPopup';

type PopupInstance = {
  renderer: ReactRenderer;
  cleanup: () => void;
};

export const WikiLinkExtension = Extension.create({
  name: 'markdownEditorWikiLink',
  addOptions() {
    return {
      suggestion: {
        char: '[[',
        startOfLine: false,
        allowSpaces: true,
        minQueryLength: 0,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: WikiLinkItem }) => {
          const label = props.label ?? props.target;
          const text = `[[${label}${props.target !== label ? `|${props.target}` : ''}]]`;
          editor.chain().focus().deleteRange(range).insertContent(text).run();
        },
        items: async ({ query }: { query: string }) => {
          try {
            const index = activeKnowledgeWorkspace.documents;
            const q = query.toLowerCase();
            const filtered = index
              .filter((doc) => !q || doc.title.toLowerCase().includes(q) || doc.path.toLowerCase().includes(q))
              .slice(0, 20)
              .map<WikiLinkItem>((doc) => ({ id: doc.uri, target: doc.path.replace(/\.(md|mdx)$/i, ''), label: doc.title, hint: doc.path }));
            // 加一个"创建新文档"项
            if (query) {
              filtered.push({ id: '__create__', target: query, label: `新建：${query}`, hint: '创建为新文档', isCreate: true });
            }
            return filtered;
          } catch {
            return [];
          }
        },
        render: () => {
          let popup: PopupInstance | null = null;
          return {
            onStart: (props: SuggestionProps<WikiLinkItem>) => {
              const renderer = new ReactRenderer(WikiLinkPopup, {
                props: { ...props, items: props.items },
                editor: props.editor,
              });
              popup = {
                renderer,
                cleanup: () => {
                  renderer.element.remove();
                  renderer.destroy();
                },
              };
              const element = renderer.element as HTMLElement;
              element.style.position = 'absolute';
              element.style.zIndex = '50';
              positionPopup(element, props.clientRect);
              document.body.appendChild(element);
            },
            onUpdate: (props: SuggestionProps<WikiLinkItem>) => {
              if (!popup) return;
              popup.renderer.updateProps({ ...props, items: props.items });
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
      } satisfies Partial<SuggestionOptions<WikiLinkItem>>,
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
  const popupWidth = element.offsetWidth || 320;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let top = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;
  if (left + popupWidth > viewportWidth - 8) left = Math.max(8, viewportWidth - popupWidth - 8);
  if (rect.bottom + popupHeight + 8 > viewportHeight && rect.top - popupHeight - 8 > 0) {
    top = rect.top + window.scrollY - popupHeight - 4;
  }
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
}
