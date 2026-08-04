import type { McpServerConfig } from '../../types/mcp';

const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function validateMcpServerConfig(config: McpServerConfig): string | undefined {
  if (!SERVER_ID_PATTERN.test(config.id)) return 'Server id must contain only letters, numbers, _ or -.';
  if (!config.name.trim()) return 'Server name is required.';
  if (config.transport === 'stdio') return config.command.trim() ? undefined : 'Server command is required.';
  try {
    const url = new URL(config.url);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return 'Remote MCP URLs must use HTTPS.';
    return undefined;
  } catch { return 'A valid MCP URL is required.'; }
}
