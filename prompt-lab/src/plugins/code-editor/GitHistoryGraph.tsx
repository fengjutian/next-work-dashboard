import React from 'react';
import type { WorkspaceGitCommit } from '@/types/electron';
import { layoutGitGraph } from './git-graph';

const GRAPH_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
const ROW_HEIGHT = 40;
const LANE_WIDTH = 18;

interface GitHistoryGraphProps {
  commits: WorkspaceGitCommit[];
  selectedHashes: string[];
  onToggleSelection: (hash: string) => void;
  onOpenCommit: (commit: WorkspaceGitCommit) => Promise<void>;
}

export const GitHistoryGraph: React.FC<GitHistoryGraphProps> = ({
  commits,
  selectedHashes,
  onToggleSelection,
  onOpenCommit,
}) => {
  const graph = React.useMemo(() => layoutGitGraph(commits), [commits]);
  const graphWidth = graph.laneCount * LANE_WIDTH + 12;
  const graphHeight = Math.max(1, commits.length * ROW_HEIGHT);

  return (
    <div className="relative" style={{ minHeight: graphHeight }}>
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={graphWidth}
        height={graphHeight}
        aria-label="Git 提交拓扑图"
      >
        {graph.edges.map((edge, index) => {
          const x1 = 12 + edge.fromLane * LANE_WIDTH;
          const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x2 = 12 + edge.toLane * LANE_WIDTH;
          const y2 = Math.min(graphHeight, edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2);
          const middle = y1 + Math.max(10, (y2 - y1) / 2);
          return (
            <path
              key={`${edge.parent}:${index}`}
              d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`}
              fill="none"
              stroke={GRAPH_COLORS[edge.color]}
              strokeWidth="2"
            />
          );
        })}
        {graph.nodes.map((node) => (
          <circle
            key={node.hash}
            cx={12 + node.lane * LANE_WIDTH}
            cy={node.row * ROW_HEIGHT + ROW_HEIGHT / 2}
            r={selectedHashes.includes(node.hash) ? 7 : 5}
            fill="var(--background)"
            stroke={GRAPH_COLORS[node.color]}
            strokeWidth="3"
          />
        ))}
      </svg>

      {commits.map((commit, index) => {
        const node = graph.nodes[index];
        return (
          <div
            key={commit.hash}
            className="flex h-10 items-center gap-2 pr-3 text-xs hover:bg-accent"
            style={{ paddingLeft: graphWidth }}
          >
            <button
              type="button"
              className="absolute h-4 w-4 rounded-full opacity-0 focus:opacity-100"
              style={{ left: 4 + node.lane * LANE_WIDTH, top: index * ROW_HEIGHT + 12 }}
              title={commit.parents.length > 1 ? `Merge commit · ${commit.parents.length} parents` : `拓扑节点 ${index + 1}`}
              onClick={() => onToggleSelection(commit.hash)}
            />
            <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void onOpenCommit(commit)}>
              <code className="text-primary">{commit.shortHash}</code>
              <span className="min-w-0 flex-1 truncate">
                {commit.subject}
                {commit.refs.map((ref) => (
                  <span key={ref} className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">{ref}</span>
                ))}
              </span>
              <span
                title={commit.signer || '未签名'}
                className={commit.signatureStatus === 'G' ? 'text-success' : commit.signatureStatus && commit.signatureStatus !== 'N' ? 'text-warning' : 'text-muted-foreground'}
              >
                {commit.signatureStatus === 'G' ? '✓ 已验证' : commit.signatureStatus && commit.signatureStatus !== 'N' ? `⚠ ${commit.signatureStatus}` : '未签名'}
              </span>
              <span className="text-muted-foreground">{commit.author} · {new Date(commit.date).toLocaleString()}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};
