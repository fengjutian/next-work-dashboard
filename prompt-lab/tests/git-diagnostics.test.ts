import { describe, expect, it } from 'vitest';
import { classifyGitError } from '../src/main/git/diagnostics';

describe('classifyGitError', () => {
  it.each([
    ['fatal: Authentication failed', 'GIT_AUTH_REQUIRED'],
    ['SSL certificate problem: unable to get local issuer certificate', 'GIT_CERTIFICATE_ERROR'],
    ['Could not resolve proxy: proxy.local', 'GIT_PROXY_ERROR'],
    ['Could not resolve host: github.com', 'GIT_NETWORK_ERROR'],
    ['ERROR: Repository not found.', 'GIT_REPOSITORY_NOT_FOUND'],
    ['Could not open a connection to your authentication agent.', 'GIT_SSH_AGENT_ERROR'],
    ['git@github.com: Permission denied (publickey).', 'GIT_PERMISSION_DENIED'],
    ["fatal: Unable to create '.git/index.lock': File exists.", 'GIT_INDEX_LOCKED'],
    ['fatal: detected dubious ownership in repository', 'GIT_SAFE_DIRECTORY'],
    ['CONFLICT (content): Merge conflict', 'GIT_CONFLICT'],
  ])('maps %s', (message, expected) => expect(classifyGitError(message)).toBe(expected));
});
