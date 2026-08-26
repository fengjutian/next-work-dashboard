const LITTERBOX_FILE_HOSTS = new Set(['litter.catbox.moe', 'litterbox.catbox.moe']);

export function parseLitterboxUploadUrl(responseText: string): string | null {
  const value = responseText.trim();
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LITTERBOX_FILE_HOSTS.has(url.hostname) && url.pathname !== '/'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
