export type GitDiagnosticCode =
  | 'GIT_AUTH_REQUIRED'
  | 'GIT_CERTIFICATE_ERROR'
  | 'GIT_PROXY_ERROR'
  | 'GIT_NETWORK_ERROR'
  | 'GIT_REPOSITORY_NOT_FOUND'
  | 'GIT_SSH_AGENT_ERROR'
  | 'GIT_PERMISSION_DENIED'
  | 'GIT_INDEX_LOCKED'
  | 'GIT_SAFE_DIRECTORY'
  | 'GIT_CONFLICT';

export function classifyGitError(raw: string): GitDiagnosticCode | undefined {
  if (/SSL certificate problem|certificate verify failed|unable to get local issuer certificate|schannel.*certificate/i.test(raw)) return 'GIT_CERTIFICATE_ERROR';
  if (/proxy (?:connect|error)|unable to access .*proxy|could not resolve proxy|407 Proxy Authentication/i.test(raw)) return 'GIT_PROXY_ERROR';
  if (/Could not resolve host|network is unreachable|connection (?:timed out|refused)|failed to connect/i.test(raw)) return 'GIT_NETWORK_ERROR';
  if (/repository (?:not found|does not exist)|not a git repository/i.test(raw)) return 'GIT_REPOSITORY_NOT_FOUND';
  if (/Could not open a connection to your authentication agent|error connecting to agent|SSH_AUTH_SOCK/i.test(raw)) return 'GIT_SSH_AGENT_ERROR';
  if (/Permission denied \(publickey|publickey,password|access denied|requested URL returned error: 403/i.test(raw)) return 'GIT_PERMISSION_DENIED';
  if (/Authentication failed|could not read Username|terminal prompts disabled|credential.*(?:failed|unavailable)/i.test(raw)) return 'GIT_AUTH_REQUIRED';
  if (/index\.lock.*(?:exists|unable to create)|Unable to create .*index\.lock/i.test(raw)) return 'GIT_INDEX_LOCKED';
  if (/dubious ownership|safe\.directory/i.test(raw)) return 'GIT_SAFE_DIRECTORY';
  if (/\bCONFLICT\b|fix conflicts and then commit/i.test(raw)) return 'GIT_CONFLICT';
  return undefined;
}
