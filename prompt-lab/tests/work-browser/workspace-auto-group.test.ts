/**
 * Workspace 自动归组
 */
import { describe, it, expect } from 'vitest';
import { suggestWorkspacesForDocument } from '@/core/work-browser/workspace/auto-group';
import type { Workspace, Tab } from '@/core/work-browser/types';

function mkWs(id: string, name: string): Workspace {
  return {
    id: id as any, name, description: '', icon: '🌊', color: '#000',
    storagePath: '', privacyMode: 'normal', createdAt: 0, updatedAt: 0, archivedAt: null,
  };
}

function mkTab(workspaceId: string, url: string, title: string, lastActivatedAt: number): Tab {
  return {
    id: `t-${url}-${title}` as any,
    workspaceId: workspaceId as any,
    url, title, favicon: null, webContentsId: null,
    isPinned: false, isMuted: false, position: 0, status: 'loaded',
    lastActivatedAt, createdAt: lastActivatedAt, activeTimeMs: 0,
  };
}

describe('suggestWorkspacesForDocument', () => {
  it('相同域名集中时给出高分', () => {
    const ws = mkWs('ws1', 'PostHog 排障');
    const t = now();
    const tabs = [
      mkTab('ws1', 'https://posthog.com/docs', 'A', t),
      mkTab('ws1', 'https://posthog.com/docs/x', 'B', t),
      mkTab('ws1', 'https://posthog.com/blog', 'C', t),
    ];
    const out = suggestWorkspacesForDocument(
      { title: 'PostHog Memory Issue', url: 'https://posthog.com/docs/new', capturedAt: t },
      [{ workspace: ws, tabs }],
    );
    expect(out.length).toBe(1);
    expect(out[0].score).toBeGreaterThan(0.4);
    expect(out[0].reasons.some((r) => r.includes('域名集中'))).toBe(true);
  });

  it('标题相似度加权', () => {
    const ws = mkWs('ws1', 'ClickHouse 内存');
    const t = now();
    const tabs = [
      mkTab('ws1', 'https://alt.com/a', 'ClickHouse 内存优化 笔记', t),
    ];
    const out = suggestWorkspacesForDocument(
      { title: 'ClickHouse 内存优化指南', url: 'https://x.com/y', capturedAt: t },
      [{ workspace: ws, tabs }],
    );
    expect(out.length).toBe(1);
    expect(out[0].reasons.some((r) => r.includes('标题相似度'))).toBe(true);
  });

  it('空 workspace 不参与', () => {
    const ws = mkWs('ws1', '空');
    const out = suggestWorkspacesForDocument(
      { title: 'X', url: 'https://x.com', capturedAt: Date.now() },
      [{ workspace: ws, tabs: [] }],
    );
    expect(out).toEqual([]);
  });

  it('archived workspace 排除', () => {
    const ws = { ...mkWs('ws1', '归档'), archivedAt: 1 };
    const tabs = [mkTab('ws1', 'https://x.com', 'X', Date.now())];
    const out = suggestWorkspacesForDocument(
      { title: 'X', url: 'https://x.com', capturedAt: Date.now() },
      [{ workspace: ws as any, tabs }],
    );
    expect(out).toEqual([]);
  });
});

function now() { return Date.now(); }
