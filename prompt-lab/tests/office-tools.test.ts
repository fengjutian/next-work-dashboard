import { afterEach, describe, expect, it, vi } from 'vitest';
import { officeTools } from '../src/core/tools/office-tools';
import { subscribeOfficeApproval } from '../src/services/office-approval';

afterEach(() => vi.unstubAllGlobals());

function tool(name: string) {
  const found = officeTools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

describe('Office Studio agent tools', () => {
  it('reads an outline through the typed bridge', async () => {
    const outline = vi.fn().mockResolvedValue({ success: true, output: 'Slide 1' });
    vi.stubGlobal('window', { electronAPI: { office: { outline } } });
    await expect(tool('office_read').execute({ filePath: 'C:\\report.pptx' })).resolves.toBe('Slide 1');
    expect(outline).toHaveBeenCalledWith('C:\\report.pptx');
  });

  it('requires confirmation before an AI write', async () => {
    const set = vi.fn().mockResolvedValue({ success: true, output: 'updated' });
    vi.stubGlobal('window', { electronAPI: { office: { set } } });
    const unsubscribe = subscribeOfficeApproval((request) => request.respond(false));
    await expect(tool('office_update').execute({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { text: 'New' } })).rejects.toThrow('用户取消');
    expect(set).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('normalizes property values after confirmation', async () => {
    const set = vi.fn().mockResolvedValue({ success: true, output: 'updated' });
    vi.stubGlobal('window', { electronAPI: { office: { set } } });
    const unsubscribe = subscribeOfficeApproval((request) => request.respond(true));
    await expect(tool('office_update').execute({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { bold: true } })).resolves.toBe('updated');
    expect(set).toHaveBeenCalledWith({ filePath: 'C:\\report.docx', path: '/body/p[1]', properties: { bold: 'true' } });
    unsubscribe();
  });

  it('creates a document through the save dialog bridge', async () => {
    const create = vi.fn().mockResolvedValue({ success: true, filePath: 'C:\\new.docx' });
    vi.stubGlobal('window', { electronAPI: { office: { create } } });
    await expect(tool('office_create').execute({ kind: 'docx' })).resolves.toContain('C:\\new.docx');
    expect(create).toHaveBeenCalledWith('docx');
  });

  it('does not remove an element without confirmation', async () => {
    const remove = vi.fn();
    vi.stubGlobal('window', { electronAPI: { office: { remove } } });
    const unsubscribe = subscribeOfficeApproval((request) => request.respond(false));
    await expect(tool('office_remove').execute({ filePath: 'C:\\report.docx', path: '/body/p[1]' })).rejects.toThrow('用户取消');
    expect(remove).not.toHaveBeenCalled();
    unsubscribe();
  });
});
