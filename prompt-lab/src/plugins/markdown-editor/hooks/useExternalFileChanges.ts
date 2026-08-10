/**
 * useExternalFileChanges — 监听工作区文件变化，转发给当前打开的文档。
 *
 * 复用 electronAPI.workspace.onFileChanged 全局事件，
 * 过滤出当前 rootPath 下的 markdown 文件并比对。
 */
import { useEffect } from 'react';
import type { MarkdownDocument } from '../types';

export interface ExternalChangesHandler {
  onChange(relativePath: string, incomingContent: string, modifiedAt: number, type: 'change' | 'rename'): void;
  /** 询问根路径是否处于 watch 状态；false 时跳过全部事件 */
  isWatching(rootPath: string): boolean;
}

export function useExternalFileChanges(rootPath: string | null, handler: ExternalChangesHandler): void {
  useEffect(() => {
    if (!rootPath) return;
    if (!handler.isWatching(rootPath)) return;
    const unsubscribe = window.electronAPI.workspace.onFileChanged((event) => {
      if (!event || typeof event.path !== 'string') return;
      const normalized = event.path.replace(/\\/g, '/');
      // 跳过非 markdown
      if (!/\.(md|markdown)$/i.test(normalized)) return;
      const relative = normalized;
      // 异步读取最新内容
      void (async () => {
        const result = await window.electronAPI.workspace.readTextFile(rootPath, relative);
        if (!result.success || !result.data) return;
        handler.onChange(relative, result.data.content, result.data.modifiedAt, event.type);
      })();
    });
    return () => {
      unsubscribe();
    };
  }, [rootPath, handler]);
}

/**
 * 判断打开的文档中是否有任意一篇正在被外部修改（用于触发关闭保护等场景）。
 */
export function findDocumentByPath(
  documents: MarkdownDocument[],
  rootPath: string,
  relativePath: string,
): MarkdownDocument | null {
  return (
    documents.find(
      (doc) => doc.rootPath === rootPath && doc.relativePath.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/'),
    ) ?? null
  );
}
