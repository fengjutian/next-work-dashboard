import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMcpApprovalPolicies, requestMcpApproval, subscribeMcpApproval } from '../src/services/mcp-approval';
import type { McpToolDescriptor } from '../src/types/mcp';

const readWriteTool: McpToolDescriptor = {
  serverId: 'files', name: 'write', inputSchema: { type: 'object' }, trustAnnotations: false,
};

afterEach(() => {
  clearMcpApprovalPolicies();
  vi.restoreAllMocks();
});

describe('MCP approval policies', () => {
  it('reuses a session approval for the same server and tool', async () => {
    const listener = vi.fn((request) => request.respond('session'));
    const unsubscribe = subscribeMcpApproval(listener);
    await expect(requestMcpApproval(readWriteTool, { path: 'a' })).resolves.toBe(true);
    await expect(requestMcpApproval(readWriteTool, { path: 'b' })).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('never reuses approval for destructive tools', async () => {
    const destructive = { ...readWriteTool, name: 'delete', annotations: { destructiveHint: true } };
    const listener = vi.fn((request) => request.respond('always'));
    const unsubscribe = subscribeMcpApproval(listener);
    await requestMcpApproval(destructive, { path: 'a' });
    await requestMcpApproval(destructive, { path: 'a' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
