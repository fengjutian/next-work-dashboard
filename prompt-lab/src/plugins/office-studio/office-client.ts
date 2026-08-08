import type { OfficeStudioAPI } from './types';

export const officeClient: OfficeStudioAPI = {
  status: () => window.electronAPI.office.status(),
  create: (kind) => window.electronAPI.office.create(kind),
  outline: (filePath) => window.electronAPI.office.outline(filePath),
  get: (filePath, path, depth) => window.electronAPI.office.get(filePath, path, depth),
  query: (filePath, selector) => window.electronAPI.office.query(filePath, selector),
  set: (request) => window.electronAPI.office.set(request),
  add: (request) => window.electronAPI.office.add(request),
  remove: (filePath, path) => window.electronAPI.office.remove(filePath, path),
  save: (filePath) => window.electronAPI.office.save(filePath),
  render: (filePath) => window.electronAPI.office.render(filePath),
  close: (filePath) => window.electronAPI.office.close(filePath),
};
