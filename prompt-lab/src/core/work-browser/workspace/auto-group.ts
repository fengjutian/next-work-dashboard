/**
 * Workspace 自动归组（PRD 第 4.1 / 5 节）
 *
 * Phase 1 启发式（轻量、不依赖 embedding）：
 *  - 域名集中度：候选 Tab 中 60% 以上同域 → 强信号
 *  - 标题关键词重叠：Jaccard ≥ 0.3 → 中等信号
 *  - 时间窗口：30 分钟内 → 强信号
 *  - URL 路径相似：同 path 前缀 → 中等信号
 *
 * 评分 0–1；> 0.55 视为"建议归组"。
 */
import type { Tab, Workspace } from '../types';

export interface GroupCandidate {
  workspaceId: string;
  score: number;
  reasons: string[];
}

function domainOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/<[^>]+>/g, ' ');
  const tokens: string[] = [];
  for (const part of normalized.split(/[^\w\u4e00-\u9fff]+/)) {
    if (!part) continue;
    if (/[\u4e00-\u9fff]/.test(part)) {
      // CJK: 每字一 token
      for (const ch of part) tokens.push(ch);
    } else {
      // ASCII: 整体作为一 token（去掉 1 字符噪声）
      if (part.length >= 2) tokens.push(part);
    }
  }
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter++; });
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function suggestWorkspacesForDocument(
  document: { title: string; url: string; capturedAt: number },
  workspaces: Array<{ workspace: Workspace; tabs: Tab[] }>,
): GroupCandidate[] {
  const candidates: GroupCandidate[] = [];
  const docDomain = domainOf(document.url);
  const docPath = pathOf(document.url);
  const docTokens = tokenize(document.title);
  const docCaptured = document.capturedAt;

  for (const { workspace, tabs } of workspaces) {
    if (workspace.archivedAt) continue;
    if (tabs.length === 0) continue;

    const reasons: string[] = [];
    let score = 0;

    // 域名集中度
    const sameDomain = tabs.filter((t) => domainOf(t.url) === docDomain).length;
    if (docDomain && sameDomain / tabs.length >= 0.6) {
      score += 0.3;
      reasons.push(`域名集中：${docDomain} 占 ${Math.round((sameDomain / tabs.length) * 100)}%`);
    }

    // 标题关键词重叠
    const titleTokens = tabs.map((t) => tokenize(t.title));
    const maxOverlap = titleTokens.reduce((acc, t) => Math.max(acc, jaccard(docTokens, t)), 0);
    if (maxOverlap >= 0.3) {
      score += maxOverlap * 0.3;
      reasons.push(`标题相似度 ${maxOverlap.toFixed(2)}`);
    }

    // URL 路径前缀
    const samePath = tabs.filter((t) => {
      const p = pathOf(t.url);
      return p && docPath && (p.startsWith(docPath.slice(0, 20)) || docPath.startsWith(p.slice(0, 20)));
    }).length;
    if (samePath > 0) {
      score += Math.min(0.15, samePath * 0.05);
      reasons.push(`路径相似 ${samePath} 条`);
    }

    // 时间窗口
    const withinWindow = tabs.filter((t) => Math.abs(t.lastActivatedAt - docCaptured) < 30 * 60 * 1000).length;
    if (withinWindow > 0) {
      score += Math.min(0.2, withinWindow * 0.05);
      reasons.push(`30 分钟内活跃 ${withinWindow} 个 Tab`);
    }

    if (score > 0) {
      candidates.push({ workspaceId: workspace.id, score: Math.min(1, score), reasons });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}
