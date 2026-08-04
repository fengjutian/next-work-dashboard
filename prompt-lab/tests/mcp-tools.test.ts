import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMcpToolDefinition } from '../src/core/tools/mcp-tools';
import { subscribeMcpApproval } from '../src/services/mcp-approval';

afterEach(() => vi.unstubAllGlobals());

describe('MCP tool adapter', () => {
  it('namespaces tools and preserves nested JSON Schema', () => {
    const tool = toMcpToolDefinition({
      serverId: 'docs',
      name: 'search',
      description: 'Search documents',
      inputSchema: {
        type: 'object',
        properties: { filter: { type: 'object', properties: { tag: { type: 'string' } } } },
      },
      trustAnnotations: false,
    });
    expect(tool.name).toBe('mcp__docs__search');
    expect(tool.parameters.properties?.filter).toMatchObject({ type: 'object' });
  });

  it('delegates execution through the typed Electron bridge', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'found' }] });
    vi.stubGlobal('window', { electronAPI: { mcp: { callTool } } });
    const tool = toMcpToolDefinition({ serverId: 'docs', name: 'search', inputSchema: { type: 'object' }, trustAnnotations: true, annotations: { readOnlyHint: true } });
    await expect(tool.execute({ query: 'MCP' })).resolves.toBe('found');
    expect(callTool).toHaveBeenCalledWith('docs', 'search', { query: 'MCP' });
  });

  it('turns MCP tool-level failures into agent tool errors', async () => {
    vi.stubGlobal('window', { electronAPI: { mcp: { callTool: vi.fn().mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'denied' }] }) } } });
    const unsubscribe = subscribeMcpApproval((request) => request.respond('once'));
    const tool = toMcpToolDefinition({ serverId: 'fs', name: 'write', inputSchema: { type: 'object' }, trustAnnotations: false });
    await expect(tool.execute({})).rejects.toThrow('denied');
    unsubscribe();
  });

  it('records rejected write-capable calls without invoking the server', async () => {
    const callTool = vi.fn();
    const recordDenial = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { electronAPI: { mcp: { callTool, recordDenial } } });
    const unsubscribe = subscribeMcpApproval((request) => request.respond('deny'));
    const tool = toMcpToolDefinition({ serverId: 'fs', name: 'delete', inputSchema: { type: 'object' }, trustAnnotations: false, annotations: { destructiveHint: true } });
    await expect(tool.execute({ path: 'a.md' })).rejects.toThrow('denied by user');
    expect(recordDenial).toHaveBeenCalledWith('fs', 'delete', { path: 'a.md' });
    expect(callTool).not.toHaveBeenCalled();
    unsubscribe();
  });
});
