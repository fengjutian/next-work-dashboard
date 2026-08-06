import type { ConversationFile } from '@/types/electron';

export const MEMORY_DIRECTORIES_KEY = 'chat.memory.directories';

export interface MemoryDirectory {
  path: string;
  name: string;
}

function normalizeFolderPath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
}

export function normalizeMemoryFilePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/$/g, '').toLocaleLowerCase();
}

export function readMemoryDirectories(): MemoryDirectory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_DIRECTORIES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MemoryDirectory => (
      typeof item?.path === 'string' && typeof item?.name === 'string'
    ));
  }
  catch {
    return [];
  }
}

export function isConversationInSelectedFolders(
  file: ConversationFile,
  directories: MemoryDirectory[],
) {
  const folder = normalizeFolderPath(file.folder ?? '');
  if (!folder) return false;
  return directories.some((directory) => {
    const selected = normalizeFolderPath(directory.path);
    return Boolean(selected) && (folder === selected || folder.startsWith(`${selected}/`));
  });
}

export async function getSelectedKnowledgeFilePaths(
  directories = readMemoryDirectories(),
): Promise<Set<string>> {
  if (directories.length === 0) return new Set();
  const files = await window.electronAPI.listConversations();
  return new Set(
    files
      .filter((file) => isConversationInSelectedFolders(file, directories))
      .map((file) => normalizeMemoryFilePath(file.path)),
  );
}
