const SECRET_QUERY_KEY = '(?:access_token|auth|key|password|private_token|token)';

/** Removes credentials from Git stdout/stderr before it reaches the renderer. */
export function redactGitSecrets(value: string): string {
  return value
    .replace(/(https?:\/\/)([^@\s/]+)@/gi, '$1[REDACTED]@')
    .replace(new RegExp(`([?&]${SECRET_QUERY_KEY}=)[^&#\\s]+`, 'gi'), '$1[REDACTED]')
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)[^\s]+/gi, '$1[REDACTED]');
}
