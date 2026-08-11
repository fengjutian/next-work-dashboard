/**
 * Work Browser — main 端入口
 */
export { setupWorkBrowserIPC } from './ipc';
export { getDatabase, closeDatabase } from './database';
export { WorkspaceStore } from './workspace-store';
export { DocumentStore } from './document-store';
export { SearchRouter } from './search-router';
export { savePageAsMarkdown } from './save';
export { getCleanerPayload } from './cleaner';
export { enqueueIndexDocument, drainIndexQueue, indexDocument } from './embedding';
