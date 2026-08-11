/**
 * 自定义 Search & Replace Tiptap 扩展 + helper functions。
 *
 * 为什么不引 @tiptap/extension-search-and-replace（v3 没有官方包）：
 *  - 需要在 protected blocks / 不可编辑节点上跳过搜索
 *  - 高亮需要与 roundtrip-guard 协同（不染 frontmatter）
 *  - 替换时如选中区跨越受保护块，要么禁止、要么仅替换安全段落
 *
 * 实现：
 *  - 用 ProseMirror Decoration.inline 高亮匹配位置
 *  - 用 plugin state 持有 searchTerm / replaceTerm / caseSensitive / regex
 *  - 不暴露 Tiptap commands（避开类型推断的复杂性），改成 helper functions
 *  - React UI 直接调用 helpers，helpers 内部 dispatch transaction
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, Selection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface SearchState {
  term: string;
  replaceTerm: string;
  caseSensitive: boolean;
  regex: boolean;
  currentIndex: number;
  total: number;
  positions: number[];
}

interface PluginMeta {
  term: string;
  replaceTerm: string;
  caseSensitive: boolean;
  regex: boolean;
  currentIndex: number;
  positions: number[];
  decorations: DecorationSet;
}

const PLUGIN_KEY = new PluginKey<PluginMeta>('markdown-editor-search-replace');

function defaultMeta(): PluginMeta {
  return {
    term: '',
    replaceTerm: '',
    caseSensitive: false,
    regex: false,
    currentIndex: -1,
    positions: [],
    decorations: DecorationSet.empty,
  };
}

function buildRegex(term: string, caseSensitive: boolean, regex: boolean): RegExp | null {
  if (!term) return null;
  if (regex) {
    try {
      return new RegExp(term, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, caseSensitive ? 'g' : 'gi');
}

function collectMatches(doc: PMNode, regex: RegExp): Array<{ from: number; to: number; text: string }> {
  const matches: Array<{ from: number; to: number; text: string }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === 'code')) return true;
    const text = node.text ?? '';
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length, text: m[0] });
    }
    return true;
  });
  return matches;
}

function buildDecorations(doc: PMNode, matches: Array<{ from: number; to: number }>, currentIndex: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, index) =>
      Decoration.inline(m.from, m.to, {
        class: index === currentIndex ? 'md-search-match md-search-match-active' : 'md-search-match',
      }),
    ),
  );
}

function recompute(state: EditorState, patch: Partial<PluginMeta>): PluginMeta {
  const meta = { ...(PLUGIN_KEY.getState(state) ?? defaultMeta()), ...patch };
  const regex = buildRegex(meta.term, meta.caseSensitive, meta.regex);
  if (!regex) {
    return { ...meta, positions: [], currentIndex: -1, decorations: DecorationSet.empty };
  }
  const matches = collectMatches(state.doc, regex);
  const positions = matches.map((m) => m.from);
  const currentIndex = positions.length === 0 ? -1 : Math.min(Math.max(meta.currentIndex < 0 ? 0 : meta.currentIndex, 0), positions.length - 1);
  return { ...meta, positions, currentIndex, decorations: buildDecorations(state.doc, matches, currentIndex) };
}

function toState(meta: PluginMeta): SearchState {
  return {
    term: meta.term,
    replaceTerm: meta.replaceTerm,
    caseSensitive: meta.caseSensitive,
    regex: meta.regex,
    currentIndex: meta.currentIndex,
    total: meta.positions.length,
    positions: meta.positions,
  };
}

export const SearchReplaceExtension = Extension.create({
  name: 'markdownSearchReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginMeta>({
        key: PLUGIN_KEY,
        state: {
          init: () => defaultMeta(),
          apply(tr, prev, _oldState, newState) {
            const metaFromTr = tr.getMeta(PLUGIN_KEY) as { meta: PluginMeta } | undefined;
            if (metaFromTr?.meta) {
              return tr.docChanged ? recompute(newState, metaFromTr.meta) : metaFromTr.meta;
            }
            if (tr.docChanged) {
              return recompute(newState, prev);
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const meta = PLUGIN_KEY.getState(state);
            return meta?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/** 读取当前搜索状态。 */
export function getSearchState(editor: Editor): SearchState {
  const meta = PLUGIN_KEY.getState(editor.state);
  return meta ? toState(meta) : { term: '', replaceTerm: '', caseSensitive: false, regex: false, currentIndex: -1, total: 0, positions: [] };
}

/** 设置搜索词。 */
export function setSearchTerm(editor: Editor, term: string): SearchState {
  const newMeta = recompute(editor.state, { term, currentIndex: 0 });
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
  return toState(newMeta);
}

/** 设置替换词。 */
export function setReplaceTerm(editor: Editor, replaceTerm: string): void {
  const meta = PLUGIN_KEY.getState(editor.state) ?? defaultMeta();
  const newMeta = { ...meta, replaceTerm };
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
}

/** 设置大小写敏感。 */
export function setCaseSensitive(editor: Editor, caseSensitive: boolean): SearchState {
  const newMeta = recompute(editor.state, { caseSensitive, currentIndex: 0 });
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
  return toState(newMeta);
}

/** 设置正则开关。 */
export function setSearchRegex(editor: Editor, regex: boolean): SearchState {
  const newMeta = recompute(editor.state, { regex, currentIndex: 0 });
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
  return toState(newMeta);
}

/** 跳到下一个匹配。 */
export function gotoNextMatch(editor: Editor): SearchState {
  const meta = PLUGIN_KEY.getState(editor.state);
  if (!meta || meta.positions.length === 0) return toState(meta ?? defaultMeta());
  const next = (meta.currentIndex + 1) % meta.positions.length;
  const newMeta: PluginMeta = { ...meta, currentIndex: next };
  // 滚动到匹配位置
  const pos = meta.positions[next];
  const tr = editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta });
  // 构造一个能让视图滚动的 selection
  const resolved = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  tr.setSelection(Selection.near(resolved));
  editor.view.dispatch(tr);
  return toState(newMeta);
}

/** 跳到上一个匹配。 */
export function gotoPrevMatch(editor: Editor): SearchState {
  const meta = PLUGIN_KEY.getState(editor.state);
  if (!meta || meta.positions.length === 0) return toState(meta ?? defaultMeta());
  const prev = (meta.currentIndex - 1 + meta.positions.length) % meta.positions.length;
  const newMeta: PluginMeta = { ...meta, currentIndex: prev };
  const pos = meta.positions[prev];
  const tr = editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta });
  const resolved = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  tr.setSelection(Selection.near(resolved));
  editor.view.dispatch(tr);
  return toState(newMeta);
}

/** 替换当前匹配项。 */
export function replaceCurrentMatch(editor: Editor): SearchState {
  const meta = PLUGIN_KEY.getState(editor.state);
  if (!meta || meta.currentIndex < 0 || meta.positions.length === 0) return toState(meta ?? defaultMeta());
  const regex = buildRegex(meta.term, meta.caseSensitive, meta.regex);
  if (!regex) return toState(meta);
  const matches = collectMatches(editor.state.doc, regex);
  const target = matches[meta.currentIndex];
  if (!target) return toState(meta);
  const tr = editor.state.tr.insertText(meta.replaceTerm, target.from, target.to);
  editor.view.dispatch(tr);
  const newMeta = recompute(editor.state, {});
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
  return toState(newMeta);
}

/** 全部替换。 */
export function replaceAllMatches(editor: Editor): SearchState {
  const meta = PLUGIN_KEY.getState(editor.state);
  if (!meta || meta.positions.length === 0) return toState(meta ?? defaultMeta());
  const regex = buildRegex(meta.term, meta.caseSensitive, meta.regex);
  if (!regex) return toState(meta);
  const matches = collectMatches(editor.state.doc, regex);
  if (matches.length === 0) return toState(meta);
  let tr = editor.state.tr;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    tr = tr.insertText(meta.replaceTerm, matches[i].from, matches[i].to);
  }
  editor.view.dispatch(tr);
  const newMeta = recompute(editor.state, {});
  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, { meta: newMeta }));
  return toState(newMeta);
}
