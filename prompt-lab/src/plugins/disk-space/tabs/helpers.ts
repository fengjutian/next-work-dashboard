/**
 * tab 组件共享的 helper 函数。
 *
 * 之前 inline 在 DiskSpacePanel.tsx 内部，拆 tab 后抽出来供 panel 和 tab 共享。
 */

import type { EChartsCoreOption } from 'echarts/core';

import { displayPath } from '../hooks/useDiskScan';
import type { DirectoryEntry } from '../hooks/useDiskScan';

export const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function compactDirectoryCandidates(entries: DirectoryEntry[], names: RegExp): DirectoryEntry[] {
  const matches = entries.filter((item) =>
    displayPath(item.path).split(/[\\/]/).some((part) => names.test(part)),
  );
  return matches
    .filter((item) => !matches.some((parent) => {
      if (parent.path === item.path) return false;
      const relative = displayPath(item.path).slice(displayPath(parent.path).length);
      return displayPath(item.path).toLowerCase().startsWith(displayPath(parent.path).toLowerCase()) && /^[\\/]/.test(relative);
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);
}

export type TreemapNode = { name: string; value?: number; path?: string; children?: TreemapNode[] };

export function buildDirectoryTree(entries: DirectoryEntry[], rootPath: string): TreemapNode[] {
  const normalized = (value: string) => displayPath(value).replace(/[\\/]+$/, '').toLowerCase();
  const selected = [...entries].sort((a, b) => b.size - a.size).slice(0, 500);
  const nodes = new Map<string, TreemapNode & { size: number }>();
  for (const entry of selected) {
    const key = normalized(entry.path);
    nodes.set(key, {
      name: displayPath(entry.path).split(/[\\/]/).filter(Boolean).at(-1) || displayPath(entry.path),
      path: entry.path,
      size: entry.size,
      children: [],
    });
  }
  const roots: Array<TreemapNode & { size: number }> = [];
  for (const [key, node] of nodes) {
    let cursor = key;
    let parent: (TreemapNode & { size: number }) | undefined;
    while (cursor.length > normalized(rootPath).length) {
      cursor = cursor.replace(/[\\/][^\\/]+$/, '');
      parent = nodes.get(cursor);
      if (parent) break;
    }
    if (parent && parent !== node) parent.children!.push(node);
    else roots.push(node);
  }
  const finalize = (node: TreemapNode & { size: number }): TreemapNode => {
    const children = node.children!
      .sort((a, b) => (b as typeof node).size - (a as typeof node).size)
      .map((child) => finalize(child as typeof node));
    const childrenTotal = children.reduce((sum, child) => sum + (child.value ?? 0), 0);
    const ownSize = Math.max(0, node.size - childrenTotal);
    if (ownSize > 0 && children.length > 0) {
      children.push({ name: '当前目录文件', value: ownSize, path: node.path });
    }
    return children.length
      ? { name: node.name, value: node.size, path: node.path, children }
      : { name: node.name, value: node.size, path: node.path };
  };
  return roots.sort((a, b) => b.size - a.size).map(finalize);
}

export function buildDirectoryTreeForTabs(entries: DirectoryEntry[], rootPath: string): TreemapNode[] {
  return buildDirectoryTree(entries, rootPath);
}
