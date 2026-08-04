import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMcpToolDefinition } from '../src/core/tools/mcp-tools';

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
    });
    expect(tool.name).toBe('mcp__docs__search');
    expect(tool.parameters.properties?.filter).toMatchObject({ type: 'object' });
  });

  it('delegates execution through the typed Electron bridge', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'found' }] });
    vi.stubGlobal('window', { electronAPI: { mcp: { callTool } } });
    const tool = toMcpToolDefinition({ serverId: 'docs', name: 'search', inputSchema: { type: 'object' } });
    await expect(tool.execute({ query: 'MCP' })).resolves.toBe('found');
    expect(callTool).toHaveBeenCalledWith('docs', 'search', { query: 'MCP' });
  });

  it('turns MCP tool-level failures into agent tool errors', async () => {
    vi.stubGlobal('window', { electronAPI: { mcp: { callTool: vi.fn().mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'denied' }] }) } } });
    const tool = toMcpToolDefinition({ serverId: 'fs', name: 'write', inputSchema: { type: 'object' } });
    await expect(tool.execute({})).rejects.toThrow('denied');
  });
});
