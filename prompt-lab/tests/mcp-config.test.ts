import { describe, expect, it } from 'vitest';
import { validateMcpServerConfig } from '../src/main/mcp/mcp-config';

describe('MCP server config security', () => {
  it('requires HTTPS for non-local Streamable HTTP servers', () => {
    expect(validateMcpServerConfig({ id: 'remote', name: 'Remote', transport: 'streamable-http', url: 'http://example.com/mcp' })).toMatch(/HTTPS/);
    expect(validateMcpServerConfig({ id: 'remote', name: 'Remote', transport: 'streamable-http', url: 'https://example.com/mcp' })).toBeUndefined();
  });

  it('allows HTTP only for loopback development servers', () => {
    expect(validateMcpServerConfig({ id: 'local', name: 'Local', transport: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' })).toBeUndefined();
    expect(validateMcpServerConfig({ id: 'local', name: 'Local', transport: 'streamable-http', url: 'http://192.168.1.2:3000/mcp' })).toMatch(/HTTPS/);
  });

  it('rejects invalid ids and empty stdio commands', () => {
    expect(validateMcpServerConfig({ id: '../bad', name: 'Bad', transport: 'stdio', command: 'node' })).toMatch(/id/);
    expect(validateMcpServerConfig({ id: 'good', name: 'Good', transport: 'stdio', command: '' })).toMatch(/command/);
  });
});
