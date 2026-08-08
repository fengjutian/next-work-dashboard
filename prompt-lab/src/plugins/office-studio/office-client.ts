import type { OfficeStudioAPI } from './types';

export const officeClient: OfficeStudioAPI = {
  status: () => window.electronAPI.office.status(),
  create: (kind) => window.electronAPI.office.create(kind),
  outline: (filePath) => window.electronAPI.office.outline(filePath),
  render: (filePath) => window.electronAPI.office.render(filePath),
  close: (filePath) => window.electronAPI.office.close(filePath),
};
