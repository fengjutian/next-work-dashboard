/**
 * Wiki Link 装饰扩展 — 给 [[…]] 文本加 CSS class。
 *
 * 实现：
 *  - ProseMirror Decoration.inline 给每个匹配范围加 `md-wiki-link` class
 *  - 跳过 code marks / code blocks
 *  - 可选：跟踪 Ctrl/Cmd 按键状态，给 hover 时的 cursor: pointer 提示
 *
 * 为什么不引 Tiptap 扩展：
 *  - 我们的 wiki link 是纯文本（不是 mention 节点）
 *  - 高亮只影响样式，不影响 roundtrip（不影响 saved content）
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { scanWikiLinksInText } from '../editor/wiki-link-parser';

const PLUGIN_KEY = new PluginKey('markdown-editor-wiki-link-decorations');
const DECORATION_CLASS = 'md-wiki-link';
const DECORATION_ACTIVE_CLASS = 'md-wiki-link-active';

export const WikiLinkDecorationsExtension = Extension.create({
  name: 'markdownWikiLinkDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PLUGIN_KEY,
        state: {
          init: (_, state) => buildDecorations(state),
          apply(tr, _prev, _oldState, newState) {
            // 文档变化或选择变化时重算
            if (tr.docChanged || tr.selectionSet) {
              return buildDecorations(newState);
            }
            return DecorationSet.empty;
          },
        },
        props: {
          decorations(state) {
            return PLUGIN_KEY.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

function buildDecorations(state: import('@tiptap/pm/state').EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === 'code')) return true;
    const text = node.text ?? '';
    for (const match of scanWikiLinksInText(text)) {
      const from = pos + match.index;
      const to = from + match.length;
      decorations.push(
        Decoration.inline(from, to, {
          class: DECORATION_CLASS,
          'data-wiki-link-target': match.target,
          'data-wiki-link-label': match.label,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(state.doc, decorations);
}
