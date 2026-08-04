import type { McpToolDescriptor } from '@/types/mcp';

export type McpApprovalDecision = 'deny' | 'once' | 'session' | 'always';

export interface McpApprovalRequest {
  id: string;
  tool: McpToolDescriptor;
  arguments: Record<string, unknown>;
  destructive: boolean;
  respond: (decision: McpApprovalDecision) => void;
}

type ApprovalListener = (request: McpApprovalRequest) => void;

const sessionPolicies = new Set<string>();
const listeners = new Set<ApprovalListener>();
const STORAGE_KEY = 'mcp-tool-approval-policies-v1';

function policyKey(tool: McpToolDescriptor): string {
  return `${tool.serverId}/${tool.name}`;
}

function permanentPolicies(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

function savePermanentPolicies(policies: Set<string>): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify([...policies].sort()));
}

export function subscribeMcpApproval(listener: ApprovalListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearMcpApprovalPolicies(): void {
  sessionPolicies.clear();
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

export async function requestMcpApproval(tool: McpToolDescriptor, args: Record<string, unknown>): Promise<boolean> {
  const destructive = tool.annotations?.destructiveHint === true;
  const key = policyKey(tool);
  if (!destructive && (sessionPolicies.has(key) || permanentPolicies().has(key))) return true;
  const listener = [...listeners][0];
  if (!listener) return false;
  return new Promise((resolve) => {
    listener({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool,
      arguments: args,
      destructive,
      respond: (decision) => {
        if (!destructive && decision === 'session') sessionPolicies.add(key);
        if (!destructive && decision === 'always') {
          const policies = permanentPolicies();
          policies.add(key);
          savePermanentPolicies(policies);
        }
        resolve(decision !== 'deny');
      },
    });
  });
}
