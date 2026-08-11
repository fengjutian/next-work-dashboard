/**
 * useWikiLinkNavigation — 在编辑器上挂点击事件，跳转 Wiki Link。
 *
 * 行为：
 *  - 用户在 Tiptap 渲染区点击
 *  - 用 ProseMirror 找到点击位置对应的文本
 *  - 如果匹配 `[[target]]` 或 `[[target|alias]]` 模式，解析 target
 *  - 通过 onNavigate 回调通知上层打开目标文件
 *
 * 设计要点：
 *  - 不修改文档结构（保持 [[…]] 是普通文本，方便 roundtrip）
 *  - 复用项目已有的 editor-navigation 时机：当用户按住 Ctrl/Cmd 点击时跳转（与多数 Wiki 风格一致）
 *  - 默认行为：单击选中；Ctrl/Cmd+点击跳转
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { findWikiLinkAt, type WikiLinkMatch } from '../editor/wiki-link-parser';

export interface UseWikiLinkNavigationOptions {
  editor: Editor | null;
  onNavigate(target: string, label: string, match: WikiLinkMatch): void;
}

export function useWikiLinkNavigation({ editor, onNavigate }: UseWikiLinkNavigationOptions): void {
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!editor) return;
      // 必须按住 Ctrl/Cmd 才触发跳转
      if (!event.ctrlKey && !event.metaKey) return;
      const view = editor.view;
      // 从 DOM 坐标反推 ProseMirror 位置
      const target = event.target as HTMLElement;
      if (!view.dom.contains(target)) return;
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!pos) return;
      const match = findWikiLinkAt(editor.state.doc, pos.pos);
      if (!match) return;
      event.preventDefault();
      // 优先从 knowledge workspace 找；如果当前文档在工作区则补全路径
      const target_ = resolveTargetPath(match.target, editor);
      void onNavigateRef.current(target_, match.label, match);
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.addEventListener('click', handleClick);
    return () => dom.removeEventListener('click', handleClick);
  }, [editor, handleClick]);
}

function resolveTargetPath(target: string, editor: Editor): string {
  // 1. 如果已经是路径（包含 / 或 \），原样返回
  if (target.includes('/') || target.includes('\\')) return target;
  // 2. 在知识工作区里查找 title 匹配
  const docs = activeKnowledgeWorkspace.documents;
  const lower = target.toLowerCase();
  const match = docs.find((d) => d.title.toLowerCase() === lower || d.path.replace(/\.(md|mdx)$/i, '').toLowerCase() === lower);
  if (match) return match.path;
  // 3. fallback：相对当前文档目录
  return `${target}.md`;
}
